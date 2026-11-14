import { encode } from "blurhash";
import sharp from "sharp";
import { db } from "@/lib/db";
import { immich } from "@/lib/immich/client";
import { PermanentJobError } from "@/lib/jobs/define";
import { computeDHash, hammingDistance } from "@/lib/media/dhash";
import { getObjectBytes, memeKey, putObject } from "@/lib/s3";

/**
 * Computes a BlurHash string from an image buffer using a 32x32 RGBA sample.
 */
export async function computeBlurhash(
	input: Buffer | Uint8Array,
): Promise<string> {
	const { data, info } = await sharp(input)
		.ensureAlpha()
		.resize(32, 32, { fit: "inside" })
		.raw()
		.toBuffer({ resolveWithObject: true });

	return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

/**
 * Generates display and thumbnail WebP renditions, calculates blurhash and 64-bit dHash,
 * performs near-duplicate detection against older memes, and marks renditionsReady.
 */
export async function generateRenditions(
	memeId: string,
	options: { immichId?: string } = {},
): Promise<void> {
	const meme = await db().meme.findUnique({ where: { id: memeId } });
	if (!meme) {
		throw new PermanentJobError(`Meme ${memeId} not found`);
	}

	if (meme.renditionsReady) {
		return;
	}

	let sourceBuffer: Buffer;

	if (meme.contentType === "image/heic" || meme.contentType === "image/heif") {
		// Sharp has no HEVC decoder; use Immich's fullsize JPEG thumbnail
		// The import passes the asset explicitly (it is not linked yet when the meme
		// is a duplicate); otherwise look up the linked asset.
		const immichId =
			options.immichId ??
			(await db().immichAsset.findFirst({ where: { memeId: meme.id } }))
				?.immichId;
		if (immichId) {
			const thumb = await immich().getThumbnail(immichId, "fullsize");
			sourceBuffer = Buffer.from(thumb.bytes);
		} else {
			const bytes = await getObjectBytes(
				memeKey(meme.id, "original", meme.contentType),
			);
			sourceBuffer = Buffer.from(bytes);
		}
	} else {
		const bytes = await getObjectBytes(
			memeKey(meme.id, "original", meme.contentType),
		);
		sourceBuffer = Buffer.from(bytes);
	}

	// For GIFs, sharp({ pages: 1 }) ensures we only process the first frame.
	const displayBuffer = await sharp(sourceBuffer, { pages: 1 })
		.rotate()
		.resize({
			width: 1600,
			height: 1600,
			fit: "inside",
			withoutEnlargement: true,
		})
		.webp({ quality: 85 })
		.toBuffer();

	const thumbBuffer = await sharp(sourceBuffer, { pages: 1 })
		.rotate()
		.resize({
			width: 400,
			height: 400,
			fit: "inside",
			withoutEnlargement: true,
		})
		.webp({ quality: 80 })
		.toBuffer();

	// Store renditions in S3
	await putObject(memeKey(meme.id, "display"), displayBuffer, "image/webp");
	await putObject(memeKey(meme.id, "thumb"), thumbBuffer, "image/webp");

	// Compute hashes from the auto-rotated display buffer
	const dhash = await computeDHash(displayBuffer);
	const blurhash = await computeBlurhash(displayBuffer);

	// Near-duplicate detection (Hamming distance <= 6). Links always point from
	// the newer meme to the older one, so they can never form a cycle. Both
	// directions are checked because renditions of two memes may run
	// concurrently, and the older one may not have had its dHash yet when the
	// newer one looked.
	const candidates = await db().meme.findMany({
		where: { id: { not: meme.id }, dhash: { not: null } },
		select: { id: true, dhash: true, createdAt: true, duplicateOfId: true },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
	const near = candidates.filter(
		(c) => c.dhash && hammingDistance(dhash, c.dhash) <= 6,
	);
	const isOlder = (c: { createdAt: Date; id: string }) =>
		c.createdAt < meme.createdAt ||
		(c.createdAt.getTime() === meme.createdAt.getTime() && c.id < meme.id);
	const olderNear = near.filter(isOlder);
	const duplicateOfId = olderNear[0]?.id ?? null;
	const newerUnlinked = near.filter((c) => !isOlder(c) && !c.duplicateOfId);

	await db().meme.update({
		where: { id: meme.id },
		data: {
			dhash,
			blurhash,
			duplicateOfId: meme.duplicateOfId ?? duplicateOfId,
			renditionsReady: true,
		},
	});
	if (newerUnlinked.length > 0) {
		await db().meme.updateMany({
			where: {
				id: { in: newerUnlinked.map((c) => c.id) },
				duplicateOfId: null,
			},
			data: { duplicateOfId: meme.id },
		});
	}
}
