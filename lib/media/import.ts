import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { db } from "@/lib/db";
import { immich } from "@/lib/immich/client";
import { PermanentJobError } from "@/lib/jobs/define";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { immichDelete } from "@/lib/jobs/definitions/immich-delete";
import { mediaRenditions } from "@/lib/jobs/definitions/media-renditions";
import { enqueue } from "@/lib/jobs/queue";
import { generateRenditions } from "@/lib/media/renditions";
import {
	deleteObjects,
	getObjectBytes,
	headObject,
	MAX_UPLOAD_BYTES,
	memeKey,
	putObject,
	uploadKey,
} from "@/lib/s3";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // 100 MiB limit

/**
 * Makes sure `media/<memeId>/original.<ext>` holds exactly `meme`'s bytes:
 * HeadObject must report the meme's size and SHA-256, otherwise the bytes (which
 * the caller has already hashed) are written again and verified. This repairs a
 * meme row left behind by an import that failed between the DB insert and the
 * S3 write, so a retry never links an asset or upload to a meme without bytes.
 * Returns true when it (re)wrote the object.
 */
async function ensureOriginalInS3(
	meme: { id: string; contentType: string; size: number; sha256: string },
	loadBytes: () => Promise<Uint8Array>,
): Promise<boolean> {
	const key = memeKey(meme.id, "original", meme.contentType);
	const sha256Base64 = Buffer.from(meme.sha256, "hex").toString("base64");
	const matches = (head: { size: number; sha256: string | undefined } | null) =>
		head != null && head.size === meme.size && head.sha256 === sha256Base64;

	if (matches(await headObject(key))) {
		return false;
	}
	const bytes = await loadBytes();
	if (bytes.byteLength !== meme.size) {
		throw new Error(
			`Cannot repair ${key}: have ${bytes.byteLength} bytes, meme has ${meme.size}`,
		);
	}
	await putObject(key, bytes, meme.contentType, { sha256Base64 });
	if (!matches(await headObject(key))) {
		throw new Error(`S3 verification failed for ${key}`);
	}
	return true;
}

const isHeic = (contentType: string) =>
	contentType === "image/heic" || contentType === "image/heif";

/**
 * Imports an accepted Immich asset into the app:
 * 1. Streams original to /tmp while computing SHA-1 and SHA-256 (enforcing 100 MiB limit).
 * 2. Compares SHA-1 against asset.checksum; on mismatch marks asset error and throws PermanentJobError.
 * 3. If a meme with the same SHA-256 exists, links the asset without uploading.
 * 4. Otherwise creates the Meme row, uploads original to S3 with ChecksumSHA256, and verifies with headObject.
 * 5. Sets asset status to imported with memeId, enqueues media.renditions, analysis.meme, and immich.delete.
 * 6. Finally deletes the temp file.
 */
export async function importFromImmich(
	immichAssetId: string,
): Promise<{ memeId: string }> {
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
	});
	if (!asset) {
		throw new PermanentJobError(`Immich asset ${immichAssetId} not found`);
	}

	// Idempotent no-op for already imported asset
	if (asset.triageStatus === "imported") {
		if (asset.memeId) {
			await enqueue(immichDelete, { immichAssetId: asset.id });
			return { memeId: asset.memeId };
		}
		// A duplicate whose meme already belongs to another asset is tracked by a
		// pending ImmichDeletion row (see below).
		const pending = await db().immichDeletion.findFirst({
			where: {
				immichAssetId: asset.id,
				status: { in: ["pending", "skipped", "failed"] },
				memeId: { not: null },
			},
			orderBy: { at: "desc" },
		});
		if (pending?.memeId) {
			await enqueue(immichDelete, { immichAssetId: asset.id });
			return { memeId: pending.memeId };
		}
		throw new PermanentJobError(
			`Immich asset ${immichAssetId} is imported but not linked to a meme`,
		);
	}

	if (asset.triageStatus !== "accepted") {
		throw new PermanentJobError(
			`Immich asset ${immichAssetId} status is "${asset.triageStatus}", expected "accepted"`,
		);
	}

	const tmpPath = path.join(
		os.tmpdir(),
		`immich-import-${asset.id}-${Date.now()}-${randomUUID()}.tmp`,
	);

	try {
		const {
			body,
			contentType,
			size: declaredSize,
		} = await immich().downloadOriginal(asset.immichId);
		if (declaredSize != null && declaredSize > MAX_IMPORT_BYTES) {
			await body.cancel().catch(() => {});
			throw new PermanentJobError("Asset exceeds 100 MiB limit");
		}
		const writeStream = fs.createWriteStream(tmpPath);
		let writeError: Error | null = null;
		writeStream.on("error", (err) => {
			writeError = err;
		});
		const sha1 = createHash("sha1");
		const sha256 = createHash("sha256");
		let totalBytes = 0;

		const reader = body.getReader();
		let finished = false;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					finished = true;
					break;
				}
				if (writeError) {
					throw writeError;
				}
				totalBytes += value.byteLength;
				if (totalBytes > MAX_IMPORT_BYTES) {
					throw new PermanentJobError("Asset exceeds 100 MiB limit");
				}
				sha1.update(value);
				sha256.update(value);
				if (!writeStream.write(value)) {
					await new Promise<void>((resolve) => {
						const done = () => {
							writeStream.off("drain", done);
							writeStream.off("error", done);
							resolve();
						};
						writeStream.on("drain", done);
						writeStream.on("error", done);
					});
				}
			}
		} finally {
			if (!finished) {
				// Size cap or write error: stop pulling from Immich.
				await reader.cancel().catch(() => {});
			}
			await new Promise<void>((resolve) => {
				writeStream.end(() => resolve());
			});
		}
		if (writeError) {
			throw writeError;
		}

		const sha1Base64 = sha1.digest("base64");
		const sha256Hex = sha256.digest("hex");
		const sha256Base64 = Buffer.from(sha256Hex, "hex").toString("base64");

		// Checksum validation
		if (sha1Base64 !== asset.checksum) {
			await db().immichAsset.update({
				where: { id: asset.id },
				data: {
					triageStatus: "error",
					error: "checksum mismatch",
				},
			});
			throw new PermanentJobError("checksum mismatch");
		}

		// Exact SHA-256 duplicate check
		const existingMeme = await db().meme.findUnique({
			where: { sha256: sha256Hex },
		});

		if (existingMeme) {
			// The bytes are only "already safe in S3" if the existing meme's original
			// is really there: verify it, and rewrite it from the verified download
			// if a previous import died before the upload.
			const repaired = await ensureOriginalInS3(existingMeme, () =>
				fs.promises.readFile(tmpPath),
			);

			if (isHeic(existingMeme.contentType) && !existingMeme.renditionsReady) {
				// Immich's fullsize JPEG is the rendition source; fetch it while the
				// asset still exists.
				await generateRenditions(existingMeme.id, {
					immichId: asset.immichId,
				});
			}

			// ImmichAsset.memeId is unique: a meme that already has an asset cannot be
			// linked again. Then a pending ImmichDeletion row carries the link and the
			// SHA-256 of the bytes downloaded from this asset, for immich.delete.
			const otherAsset = await db().immichAsset.findFirst({
				where: { memeId: existingMeme.id, id: { not: asset.id } },
			});
			if (otherAsset) {
				const hasPending = await db().immichDeletion.findFirst({
					where: {
						immichAssetId: asset.id,
						status: "pending",
						memeId: existingMeme.id,
					},
				});
				if (!hasPending) {
					await db().immichDeletion.create({
						data: {
							immichAssetId: asset.id,
							immichId: asset.immichId,
							memeId: existingMeme.id,
							status: "pending",
							verifiedSha256: sha256Base64,
						},
					});
				}
			}
			await db().immichAsset.update({
				where: { id: asset.id },
				data: {
					triageStatus: "imported",
					memeId: otherAsset ? undefined : existingMeme.id,
				},
			});
			if (repaired) {
				await enqueue(mediaRenditions, { memeId: existingMeme.id });
				await enqueue(analysisMeme, { memeId: existingMeme.id });
			}
			await enqueue(immichDelete, { immichAssetId: asset.id });
			return { memeId: existingMeme.id };
		}

		// Sniff dimensions from temp file
		const meta = await sharp(tmpPath)
			.metadata()
			.catch(() => null);
		const ct = asset.mimeType || contentType || "image/jpeg";
		const fileBytes = await fs.promises.readFile(tmpPath);

		const meme = await db().meme.create({
			data: {
				source: "immich",
				status: "inbox",
				contentType: ct,
				size: totalBytes,
				width: meta?.width ?? asset.width ?? null,
				height: meta?.height ?? asset.height ?? null,
				sha256: sha256Hex,
				takenAt: asset.fileCreatedAt,
			},
		});

		const key = memeKey(meme.id, "original", ct);
		await putObject(key, fileBytes, ct, { sha256Base64 });

		const verifiedHead = await headObject(key);
		if (
			!verifiedHead ||
			verifiedHead.size !== totalBytes ||
			verifiedHead.sha256 !== sha256Base64
		) {
			throw new Error(`S3 verification failed for ${key}`);
		}

		if (isHeic(ct)) {
			// Renditions come from Immich's fullsize JPEG, which is gone once
			// immich.delete has run: make them before the delete is queued.
			await generateRenditions(meme.id, { immichId: asset.immichId });
		}

		await db().immichAsset.update({
			where: { id: asset.id },
			data: {
				triageStatus: "imported",
				memeId: meme.id,
			},
		});

		await enqueue(mediaRenditions, { memeId: meme.id });
		await enqueue(analysisMeme, { memeId: meme.id });
		await enqueue(immichDelete, { immichAssetId: asset.id });

		return { memeId: meme.id };
	} finally {
		await fs.promises.unlink(tmpPath).catch(() => {});
	}
}

const FORMAT_MIMES: Record<string, string> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
};

/**
 * Imports a completed direct upload into the app:
 * 1. Reads staging object from S3 uploads/<uploadId>.
 * 2. Sniffs real MIME type with sharp and rejects mismatches.
 * 3. Computes SHA-256; if a meme with that hash exists, links upload to it.
 * 4. Otherwise creates the Meme row and writes the original to media/<memeId>/original.<ext>.
 * 5. Deletes the staging object and marks upload imported.
 * 6. Enqueues media.renditions and analysis.meme (for new memes).
 */
export async function importFromUpload(
	uploadId: string,
): Promise<{ memeId: string }> {
	const upload = await db().upload.findUnique({ where: { id: uploadId } });
	if (!upload) {
		throw new PermanentJobError(`Upload ${uploadId} not found`);
	}

	if (upload.status === "imported" && upload.memeId) {
		return { memeId: upload.memeId };
	}

	if (upload.status !== "complete") {
		throw new PermanentJobError(
			`Upload ${uploadId} status is "${upload.status}", expected "complete"`,
		);
	}

	const stagingKey = uploadKey(upload.id);
	const head = await headObject(stagingKey);
	if (!head) {
		throw new PermanentJobError(`Staging object ${stagingKey} not found in S3`);
	}

	// The presigned PUT does not bound the size and stays valid for 15 minutes:
	// re-check what is actually in the bucket before reading it into memory.
	if (head.size !== upload.size || head.size > MAX_UPLOAD_BYTES) {
		await db().upload.update({
			where: { id: upload.id },
			data: { status: "failed", error: "Uploaded size mismatch" },
		});
		await deleteObjects([stagingKey]);
		throw new PermanentJobError(
			`Staging object ${stagingKey} is ${head.size} bytes, declared ${upload.size}`,
		);
	}

	const fileBytes = await getObjectBytes(stagingKey);
	const buffer = Buffer.from(fileBytes);

	let meta: Metadata;
	try {
		meta = await sharp(buffer).metadata();
	} catch {
		await db().upload.update({
			where: { id: upload.id },
			data: { status: "failed", error: "Invalid image format" },
		});
		await deleteObjects([stagingKey]);
		throw new PermanentJobError("Invalid image format");
	}

	const sniffedMime = meta.format ? FORMAT_MIMES[meta.format] : undefined;
	if (!sniffedMime || sniffedMime !== upload.contentType) {
		await db().upload.update({
			where: { id: upload.id },
			data: { status: "failed", error: "Content type mismatch" },
		});
		await deleteObjects([stagingKey]);
		throw new PermanentJobError(
			`Content type mismatch: declared ${upload.contentType}, detected ${sniffedMime ?? "unknown"}`,
		);
	}

	const sha256Hex = createHash("sha256").update(buffer).digest("hex");
	const sha256Base64 = createHash("sha256").update(buffer).digest("base64");

	// Exact duplicate check
	const existingMeme = await db().meme.findUnique({
		where: { sha256: sha256Hex },
	});

	if (existingMeme) {
		// The staging object is about to be deleted: make sure the existing
		// meme's original really holds these bytes (a failed earlier import may
		// have left the row without its object).
		const repaired = await ensureOriginalInS3(existingMeme, async () => buffer);
		await db().upload.update({
			where: { id: upload.id },
			data: {
				status: "imported",
				memeId: existingMeme.id,
			},
		});
		await deleteObjects([stagingKey]);
		if (repaired) {
			await enqueue(mediaRenditions, { memeId: existingMeme.id });
			await enqueue(analysisMeme, { memeId: existingMeme.id });
		}
		return { memeId: existingMeme.id };
	}

	const meme = await db().meme.create({
		data: {
			source: "upload",
			status: "inbox",
			contentType: upload.contentType,
			size: buffer.byteLength,
			width: meta.width ?? null,
			height: meta.height ?? null,
			sha256: sha256Hex,
			takenAt: null,
		},
	});

	const key = memeKey(meme.id, "original", upload.contentType);
	await putObject(key, buffer, upload.contentType, { sha256Base64 });

	const verifiedHead = await headObject(key);
	if (
		!verifiedHead ||
		verifiedHead.size !== buffer.byteLength ||
		(verifiedHead.sha256 && verifiedHead.sha256 !== sha256Base64)
	) {
		throw new Error(`S3 verification failed for ${key}`);
	}

	await db().upload.update({
		where: { id: upload.id },
		data: {
			status: "imported",
			memeId: meme.id,
		},
	});

	await deleteObjects([stagingKey]);

	await enqueue(mediaRenditions, { memeId: meme.id });
	await enqueue(analysisMeme, { memeId: meme.id });

	return { memeId: meme.id };
}
