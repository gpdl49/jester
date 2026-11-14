import type { Sensitivity } from "@/lib/api/types";
import {
	DEFAULT_CAPTION_TEMPLATE,
	DEFAULT_UNKNOWN_CREDIT,
	getSetting,
} from "@/lib/settings";

export type CaptionMemeInput = {
	creditText: string | null;
	hashtags: string[];
	sensitivity?: Sensitivity | null | unknown;
};

export type RenderCaptionInput = {
	caption: string;
	items: {
		meme: CaptionMemeInput;
	}[];
};

export type RenderCaptionResult = {
	text: string;
	warnings: string[];
};

export const MAX_CAPTION_LENGTH = 2200;
export const MAX_HASHTAGS_COUNT = 30;

function isSensitive(sensitivity: unknown): boolean {
	if (!sensitivity || typeof sensitivity !== "object") {
		return false;
	}
	const s = sensitivity as Record<string, unknown>;
	return Boolean(s.nsfw || s.politics || s.slurs || s.personalData);
}

function normalizeHashtag(tag: string): string {
	const cleaned = tag.trim().replace(/^#+/, "");
	return cleaned.length > 0 ? `#${cleaned}` : "";
}

function buildRenderedText(
	template: string,
	caption: string,
	credit: string,
	hashtags: string,
): string {
	const replaced = template
		.replace("{caption}", caption)
		.replace("{credit}", credit)
		.replace("{hashtags}", hashtags);

	// Collapse 3+ newlines to 2 and trim.
	return replaced.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Pure caption renderer for Instagram publishing and live previews.
 * Applies the `caption.template` setting with `{caption}`, `{credit}`, and `{hashtags}`.
 * Enforces Instagram limits (2,200 chars, ≤ 30 hashtags), collapses extra newlines,
 * and emits warnings for truncation, sensitive content, and missing attributions.
 */
export async function renderCaption(
	post: RenderCaptionInput,
): Promise<RenderCaptionResult> {
	const warnings: string[] = [];

	let template = DEFAULT_CAPTION_TEMPLATE;
	let unknownCredit = DEFAULT_UNKNOWN_CREDIT;
	try {
		template = await getSetting("caption.template");
		unknownCredit = await getSetting("caption.unknownCredit");
	} catch {
		// Fallback to defaults if settings can't be fetched (e.g. unit test without DB)
	}

	// 1. Credit computation
	const confirmedCredits = post.items
		.map((item) => item.meme.creditText?.trim())
		.filter((c): c is string => Boolean(c && c.length > 0));

	const dedupedCredits = Array.from(new Set(confirmedCredits));

	let creditStr = "";
	if (dedupedCredits.length > 0) {
		creditStr = dedupedCredits.map((c) => `📸 ${c}`).join(" · ");
	} else {
		creditStr = unknownCredit;
	}

	// Warning: unknown creator if any item lacks confirmed creditText or if no items
	const hasUnknownCreator =
		post.items.length === 0 ||
		post.items.some((item) => !item.meme.creditText?.trim());
	if (hasUnknownCreator) {
		warnings.push("Unknown creator");
	}

	// 2. Hashtags computation
	const allTags: string[] = [];
	for (const item of post.items) {
		for (const h of item.meme.hashtags ?? []) {
			const norm = normalizeHashtag(h);
			if (norm && !allTags.includes(norm)) {
				allTags.push(norm);
			}
		}
	}

	if (allTags.length > MAX_HASHTAGS_COUNT) {
		warnings.push("Hashtags trimmed to 30");
	}
	const finalTags = allTags.slice(0, MAX_HASHTAGS_COUNT);
	const hashtagsStr = finalTags.join(" ");

	// 3. Sensitivity check
	const anySensitive = post.items.some((item) =>
		isSensitive(item.meme.sensitivity),
	);
	if (anySensitive) {
		warnings.push("Post contains sensitive content");
	}

	// 4. Caption rendering and length truncation
	let captionPart = post.caption ?? "";
	let rendered = buildRenderedText(
		template,
		captionPart,
		creditStr,
		hashtagsStr,
	);

	if (rendered.length > MAX_CAPTION_LENGTH) {
		warnings.push("Caption exceeds 2,200 characters (truncated)");

		// Truncate captionPart so that rendered.length <= MAX_CAPTION_LENGTH.
		// Binary search the longest caption slice that fits.
		let low = 0;
		let high = captionPart.length;
		let bestCaption = "";

		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const testCaption = captionPart.slice(0, mid);
			const testRendered = buildRenderedText(
				template,
				testCaption,
				creditStr,
				hashtagsStr,
			);
			if (testRendered.length <= MAX_CAPTION_LENGTH) {
				bestCaption = testCaption;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		captionPart = bestCaption;
		rendered = buildRenderedText(template, captionPart, creditStr, hashtagsStr);
	}

	return {
		text: rendered,
		warnings,
	};
}
