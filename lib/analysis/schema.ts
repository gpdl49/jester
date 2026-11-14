import { z } from "zod";
import type { MemeAnalysisResult, Quality, Sensitivity } from "@/lib/api/types";

/**
 * Converts a string into a lowercase slug suitable for Tag names.
 * Removes apostrophes, converts non-alphanumeric chars to hyphens, trims dashes.
 */
export function slugify(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Normalizes a hashtag: strips leading '#', lowercases, slugs, and strips dashes.
 */
export function normalizeHashtag(input: string): string {
	return input
		.replace(/^#+/, "")
		.toLowerCase()
		.trim()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export const sensitivitySchema: z.ZodType<Sensitivity> = z.object({
	nsfw: z.boolean(),
	politics: z.boolean(),
	slurs: z.boolean(),
	personalData: z.boolean(),
	notes: z.string().nullable(),
});

export const qualitySchema: z.ZodType<Quality> = z.object({
	lowRes: z.boolean(),
	heavyCompression: z.boolean(),
	cropped: z.boolean(),
	watermark: z.boolean(),
});

export const attributionCluesSchema = z.object({
	watermarks: z.array(z.string()).default([]),
	handles: z.array(z.string()).default([]),
	sites: z.array(z.string()).default([]),
	subreddits: z.array(z.string()).default([]),
});

/**
 * Validates and normalizes raw model output into a valid MemeAnalysisResult:
 * - Clamps postability to 0-100 (integer)
 * - Lowercases, slugs, and dedupes topics (max 8)
 * - Lowercases, slugs, and dedupes styles (max 4)
 * - Clamps alt text to <= 250 chars
 * - Strips hashtags and clamps caption draft to <= 150 chars
 * - Normalizes, dedupes hashtags (max 15)
 */
export const memeAnalysisResultSchema = z
	.object({
		ocrText: z.string().default(""),
		description: z.string().default(""),
		altText: z.string().default(""),
		template: z
			.string()
			.nullable()
			.transform((val) => {
				if (!val) return null;
				const trimmed = val.trim();
				return trimmed.length > 0 ? trimmed : null;
			}),
		language: z.string().default("en"),
		era: z
			.string()
			.nullable()
			.transform((val) => {
				if (!val) return null;
				const trimmed = val.trim();
				return trimmed.length > 0 ? trimmed : null;
			}),
		topics: z
			.array(z.string())
			.default([])
			.transform((items) => {
				const deduped = new Set<string>();
				for (const item of items) {
					const slug = slugify(item);
					if (slug) deduped.add(slug);
				}
				return Array.from(deduped).slice(0, 8);
			}),
		styles: z
			.array(z.string())
			.default([])
			.transform((items) => {
				const deduped = new Set<string>();
				for (const item of items) {
					const slug = slugify(item);
					if (slug) deduped.add(slug);
				}
				return Array.from(deduped).slice(0, 4);
			}),
		sensitivity: sensitivitySchema,
		quality: qualitySchema,
		postability: z
			.number()
			.transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
		captionDraft: z
			.string()
			.default("")
			.transform((s) =>
				s.replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 150),
			),
		hashtags: z
			.array(z.string())
			.default([])
			.transform((items) => {
				const deduped = new Set<string>();
				for (const item of items) {
					const normalized = normalizeHashtag(item);
					if (normalized) deduped.add(normalized);
				}
				return Array.from(deduped).slice(0, 15);
			}),
		attributionClues: attributionCluesSchema,
	})
	.transform((res): MemeAnalysisResult => {
		return {
			...res,
			altText: res.altText.slice(0, 250),
		};
	});

/**
 * Strict JSON Schema mirroring MemeAnalysisResult for OpenRouter structured completion.
 * Conforms to OpenAI/OpenRouter strict JSON schema:
 * - Every object has additionalProperties: false
 * - Every property defined in properties must be present in required
 */
export const MEME_ANALYSIS_JSON_SCHEMA = {
	type: "object",
	properties: {
		ocrText: {
			type: "string",
			description:
				"Verbatim text extracted from the meme image, including handles and watermarks",
		},
		description: {
			type: "string",
			description:
				"Objective description of the visual scene, subject, format, and joke",
		},
		altText: {
			type: "string",
			description:
				"Concise screen reader alt text (250 chars max) describing the image",
		},
		template: {
			type: ["string", "null"],
			description:
				"Known canonical meme template name (e.g. 'Drake Hotline Bling', 'Distracted Boyfriend') or null if not a standard template",
		},
		language: {
			type: "string",
			description:
				"Two-letter ISO 639-1 language code of text (e.g. 'en'), or 'unknown'",
		},
		era: {
			type: ["string", "null"],
			description:
				"Estimated era or year range when this meme originated (e.g. '2012-2014'), or null",
		},
		topics: {
			type: "array",
			items: { type: "string" },
			description: "Up to 8 keywords/topics representing the subject matter",
		},
		styles: {
			type: "array",
			items: { type: "string" },
			description:
				"Up to 4 style descriptors (e.g. screenshot, deepfried, wholesome, surreal, comic)",
		},
		sensitivity: {
			type: "object",
			properties: {
				nsfw: { type: "boolean" },
				politics: { type: "boolean" },
				slurs: { type: "boolean" },
				personalData: {
					type: "boolean",
					description:
						"True if names, phone numbers, emails, or faces of private individuals appear in chat/DM screenshots",
				},
				notes: { type: ["string", "null"] },
			},
			required: ["nsfw", "politics", "slurs", "personalData", "notes"],
			additionalProperties: false,
		},
		quality: {
			type: "object",
			properties: {
				lowRes: { type: "boolean" },
				heavyCompression: { type: "boolean" },
				cropped: { type: "boolean" },
				watermark: { type: "boolean" },
			},
			required: ["lowRes", "heavyCompression", "cropped", "watermark"],
			additionalProperties: false,
		},
		postability: {
			type: "integer",
			description:
				"0-100 score for a general meme page (penalise sensitivity, low quality, inside jokes, and watermarks of other meme pages)",
		},
		captionDraft: {
			type: "string",
			description:
				"Punchy caption draft for Instagram (no hashtags, <= 150 chars, never claiming authorship)",
		},
		hashtags: {
			type: "array",
			items: { type: "string" },
			description: "Up to 15 relevant hashtags without '#'",
		},
		attributionClues: {
			type: "object",
			properties: {
				watermarks: { type: "array", items: { type: "string" } },
				handles: { type: "array", items: { type: "string" } },
				sites: { type: "array", items: { type: "string" } },
				subreddits: { type: "array", items: { type: "string" } },
			},
			required: ["watermarks", "handles", "sites", "subreddits"],
			additionalProperties: false,
		},
	},
	required: [
		"ocrText",
		"description",
		"altText",
		"template",
		"language",
		"era",
		"topics",
		"styles",
		"sensitivity",
		"quality",
		"postability",
		"captionDraft",
		"hashtags",
		"attributionClues",
	],
	additionalProperties: false,
} as const;
