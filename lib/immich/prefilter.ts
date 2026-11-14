import type { PrefilterSignals } from "@/lib/api/types";

export const FILENAME_REGEX =
	/screenshot|screen shot|^IMG_\d+\.PNG$|received_|FB_IMG|-WA\d+|reddit|9gag|ifunny|meme/i;

export type PrefilterAssetInput = {
	originalFileName?: string | null;
	mimeType?: string | null;
	originalMimeType?: string | null;
	width?: number | null;
	height?: number | null;
	cameraMake?: string | null;
	cameraModel?: string | null;
	exifInfo?: {
		make?: string | null;
		model?: string | null;
		exifImageWidth?: number | null;
		exifImageHeight?: number | null;
	} | null;
	ocrText?: string | null;
	smartHits?: string[] | null;
};

export type PrefilterContext = {
	smartHits?: string[];
	ocrText?: string | null;
};

export type PrefilterResult = {
	score: number;
	signals: PrefilterSignals;
};

/**
 * Pure prefilter scoring for Immich assets (docs/contract.md "Prefilter score").
 * Signals:
 * +0.30 when MIME type is PNG, WebP or GIF
 * +0.25 when filename matches regex
 * +0.15 when EXIF has no camera make or model
 * +0.10 when dimensions match a phone screen (aspect >= 1.9 portrait) or a square
 * +0.30 when asset is in top results of any smart-search query
 * +0.15 when Immich OCR text has >= 5 words
 * Capped at 1.0.
 */
export function scorePrefilter(
	asset: PrefilterAssetInput,
	context: PrefilterContext = {},
): PrefilterResult {
	let rawScore = 0;
	const signals: PrefilterSignals = {};

	// 1. MIME type: PNG, WebP or GIF (+0.30)
	const mimeString = (asset.mimeType || asset.originalMimeType || "")
		.toLowerCase();
	const parts = mimeString.split(";");
	const rawMime = parts[0]?.trim() ?? "";
	if (
		rawMime === "image/png" ||
		rawMime === "image/webp" ||
		rawMime === "image/gif"
	) {
		signals.mime = true;
		rawScore += 0.3;
	}

	// 2. Filename matches regex (+0.25)
	const filename = asset.originalFileName ?? "";
	if (FILENAME_REGEX.test(filename)) {
		signals.filename = true;
		rawScore += 0.25;
	}

	// 3. EXIF has no camera make or model (+0.15)
	const make = (asset.cameraMake ?? asset.exifInfo?.make ?? "").trim();
	const model = (asset.cameraModel ?? asset.exifInfo?.model ?? "").trim();
	if (!make && !model) {
		signals.noCamera = true;
		rawScore += 0.15;
	}

	// 4. Dimensions match phone screen (aspect >= 1.9 portrait) or a square (+0.10)
	const width = asset.width ?? asset.exifInfo?.exifImageWidth;
	const height = asset.height ?? asset.exifInfo?.exifImageHeight;
	if (
		typeof width === "number" &&
		typeof height === "number" &&
		width > 0 &&
		height > 0
	) {
		const isSquare = width === height;
		const isPhoneScreen = height >= width && height / width >= 1.9;
		if (isSquare || isPhoneScreen) {
			signals.screenDims = true;
			rawScore += 0.1;
		}
	}

	// 5. Smart search hit (+0.30)
	const hits = context.smartHits ?? asset.smartHits ?? [];
	if (Array.isArray(hits) && hits.length > 0) {
		signals.smartHit = true;
		rawScore += 0.3;
	}

	// 6. Immich OCR text has >= 5 words (+0.15)
	const ocr = context.ocrText ?? asset.ocrText ?? "";
	if (typeof ocr === "string" && ocr.trim().length > 0) {
		const words = ocr.trim().split(/\s+/).filter(Boolean);
		if (words.length >= 5) {
			signals.ocrWords = true;
			rawScore += 0.15;
		}
	}

	const rounded = Math.round(rawScore * 100) / 100;
	const score = Math.min(1, rounded);

	return { score, signals };
}
