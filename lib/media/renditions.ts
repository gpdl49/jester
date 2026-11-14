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
export async function generateRenditions(memeId: string): Promise<void> {
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
		const asset = await db().immichAsset.findFirst({
			where: { memeId: meme.id },
		});
		if (asset) {
			const thumb = await immich().getThumbnail(asset.immichId, "fullsize");
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

	// Duplicate detection (Hamming distance <= 6 against older memes)
	let duplicateOfId: string | null = null;
	const prefix = dhash.slice(0, 4);

	// Prefilter by first 4 hex chars
	const bucketCandidates = await db().meme.findMany({
		where: {
			id: { not: meme.id },
			dhash: { startsWith: prefix },
		},
		select: { id: true, dhash: true, createdAt: true },
		orderBy: { createdAt: "asc" },
	});

	const matchingBucket = bucketCandidates.filter(
		(c) => c.dhash && hammingDistance(dhash, c.dhash) <= 6,
	);

	if (matchingBucket.length > 0) {
		duplicateOfId = matchingBucket[0]?.id ?? null;
	} else {
		// Prefilter missed: compare all memes with a dhash
		const allMemes = await db().meme.findMany({
			where: {
				id: { not: meme.id },
				dhash: { not: null },
			},
			select: { id: true, dhash: true, createdAt: true },
			orderBy: { createdAt: "asc" },
		});

		const allMatches = allMemes.filter(
			(m) => m.dhash && hammingDistance(dhash, m.dhash) <= 6,
		);

		if (allMatches.length > 0) {
			duplicateOfId = allMatches[0]?.id ?? null;
		}
	}

	await db().meme.update({
		where: { id: meme.id },
		data: {
			dhash,
			blurhash,
			duplicateOfId: duplicateOfId ?? meme.duplicateOfId,
			renditionsReady: true,
		},
	});
}
