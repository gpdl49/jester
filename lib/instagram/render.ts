import sharp from "sharp";
import { db } from "@/lib/db";
import {
	extensionFor,
	getObjectBytes,
	instagramKey,
	memeKey,
	putObject,
} from "@/lib/s3";

export const MIN_ASPECT_RATIO = 4 / 5; // 0.8
export const MAX_ASPECT_RATIO = 1.91; // 1.91:1
export const TARGET_WIDTH = 1080;

export type CanvasGeometry = {
	canvasWidth: number;
	canvasHeight: number;
	imageWidth: number;
	imageHeight: number;
	left: number;
	top: number;
	aspectRatio: number;
};

/**
 * Pure function: calculates target canvas dimensions and image placement
 * for Instagram rendition clamped to [4:5, 1.91:1].
 *
 * - Taller than 4:5 -> pad left and right to 4:5
 * - Wider than 1.91:1 -> pad top and bottom to 1.91:1
 * - Carousel items -> forced to targetRatio (first item's aspect ratio)
 */
export function targetCanvas(
	w: number,
	h: number,
	targetRatio?: number,
): CanvasGeometry {
	const rawRatio = w / h;
	const aspectRatio =
		targetRatio !== undefined
			? targetRatio
			: Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, rawRatio));

	const canvasWidth = TARGET_WIDTH;
	const canvasHeight = Math.round(TARGET_WIDTH / aspectRatio);

	let imageWidth: number;
	let imageHeight: number;
	let left = 0;
	let top = 0;

	if (rawRatio < aspectRatio) {
		// Taller than target canvas aspect ratio -> fit height, pad left & right
		imageHeight = canvasHeight;
		imageWidth = Math.round(canvasHeight * rawRatio);
		left = Math.round((canvasWidth - imageWidth) / 2);
	} else if (rawRatio > aspectRatio) {
		// Wider than target canvas aspect ratio -> fit width, pad top & bottom
		imageWidth = canvasWidth;
		imageHeight = Math.round(canvasWidth / rawRatio);
		top = Math.round((canvasHeight - imageHeight) / 2);
	} else {
		// Exact match
		imageWidth = canvasWidth;
		imageHeight = canvasHeight;
	}

	return {
		canvasWidth,
		canvasHeight,
		imageWidth,
		imageHeight,
		left,
		top,
		aspectRatio,
	};
}

/**
 * Calculates the median colour of the border pixels of an image.
 * Falls back to white on failure.
 */
export async function computeEdgeMedianColor(
	imageBuffer: Buffer | Uint8Array,
): Promise<{ r: number; g: number; b: number }> {
	try {
		const { data, info } = await sharp(imageBuffer)
			.resize(100, 100, { fit: "fill" })
			.raw()
			.toBuffer({ resolveWithObject: true });

		const rVals: number[] = [];
		const gVals: number[] = [];
		const bVals: number[] = [];

		const { width, height, channels } = info;
		for (let x = 0; x < width; x++) {
			// Top row
			const topIdx = x * channels;
			rVals.push(data[topIdx]);
			gVals.push(data[topIdx + 1]);
			bVals.push(data[topIdx + 2]);

			// Bottom row
			const botIdx = ((height - 1) * width + x) * channels;
			rVals.push(data[botIdx]);
			gVals.push(data[botIdx + 1]);
			bVals.push(data[botIdx + 2]);
		}

		for (let y = 1; y < height - 1; y++) {
			// Left column
			const leftIdx = y * width * channels;
			rVals.push(data[leftIdx]);
			gVals.push(data[leftIdx + 1]);
			bVals.push(data[leftIdx + 2]);

			// Right column
			const rightIdx = (y * width + width - 1) * channels;
			rVals.push(data[rightIdx]);
			gVals.push(data[rightIdx + 1]);
			bVals.push(data[rightIdx + 2]);
		}

		const median = (arr: number[]) => {
			arr.sort((a, b) => a - b);
			return arr[Math.floor(arr.length / 2)] ?? 255;
		};

		return {
			r: median(rVals),
			g: median(gVals),
			b: median(bVals),
		};
	} catch {
		return { r: 255, g: 255, b: 255 };
	}
}

/**
 * Renders an image buffer to Instagram requirements:
 * Width 1080, aspect ratio clamped to [4:5, 1.91:1], edge median background padding,
 * sRGB JPEG q90, <= 8MB.
 */
export async function renderImageBuffer(
	sourceBuffer: Buffer | Uint8Array,
	targetRatio?: number,
): Promise<{ buffer: Buffer; geometry: CanvasGeometry }> {
	const metadata = await sharp(sourceBuffer).metadata();
	const origW = metadata.width ?? TARGET_WIDTH;
	const origH = metadata.height ?? TARGET_WIDTH;

	const geometry = targetCanvas(origW, origH, targetRatio);
	const bgColor = await computeEdgeMedianColor(sourceBuffer);

	const resizedImage = await sharp(sourceBuffer)
		.resize(geometry.imageWidth, geometry.imageHeight)
		.toBuffer();

	let quality = 90;
	let output: Buffer;
	const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

	while (true) {
		output = await sharp({
			create: {
				width: geometry.canvasWidth,
				height: geometry.canvasHeight,
				channels: 3,
				background: bgColor,
			},
		})
			.composite([
				{
					input: resizedImage,
					left: geometry.left,
					top: geometry.top,
				},
			])
			.toColourspace("srgb")
			.jpeg({ quality })
			.toBuffer();

		if (output.length <= MAX_BYTES || quality <= 30) {
			break;
		}
		quality -= 10;
	}

	return { buffer: output, geometry };
}

/**
 * Renders each item in the post to S3: `ig/<postId>/<position>.jpg`.
 */
export async function renderPost(postId: string): Promise<string[]> {
	const post = await db().post.findUnique({
		where: { id: postId },
		include: {
			items: {
				include: { meme: true },
				orderBy: { position: "asc" },
			},
		},
	});

	if (!post) {
		throw new Error(`Post not found: ${postId}`);
	}
	if (post.items.length === 0) {
		throw new Error(`Post has no items: ${postId}`);
	}

	const sourceBuffers: Buffer[] = [];
	for (const item of post.items) {
		const isHeic =
			item.meme.contentType === "image/heic" ||
			item.meme.contentType === "image/heif";
		const key = isHeic
			? memeKey(item.meme.id, "display")
			: memeKey(item.meme.id, "original", item.meme.contentType);

		const bytes = await getObjectBytes(key);
		sourceBuffers.push(Buffer.from(bytes));
	}

	let carouselRatio: number | undefined;
	if (post.items.length > 1) {
		const meta0 = await sharp(sourceBuffers[0]).metadata();
		const w0 = meta0.width ?? TARGET_WIDTH;
		const h0 = meta0.height ?? TARGET_WIDTH;
		carouselRatio = Math.max(
			MIN_ASPECT_RATIO,
			Math.min(MAX_ASPECT_RATIO, w0 / h0),
		);
	}

	const writtenKeys: string[] = [];

	for (let i = 0; i < post.items.length; i++) {
		const item = post.items[i];
		const sourceBuf = sourceBuffers[i];
		const { buffer } = await renderImageBuffer(sourceBuf, carouselRatio);
		const key = instagramKey(postId, item.position);
		await putObject(key, buffer, "image/jpeg");
		writtenKeys.push(key);
	}

	return writtenKeys;
}
