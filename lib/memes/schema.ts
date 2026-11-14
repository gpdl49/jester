import { z } from "zod";
import { MEME_STATUSES } from "@/lib/api/types";

const booleanQuery = z.preprocess((val) => {
	if (val === undefined || val === null || val === "") return undefined;
	if (val === "true" || val === true) return true;
	if (val === "false" || val === false) return false;
	return val;
}, z.boolean().optional());

export const memeListQuerySchema = z
	.object({
		status: z.enum(MEME_STATUSES).optional(),
		tag: z.string().trim().min(1).optional(),
		template: z.string().trim().min(1).optional(),
		q: z.string().trim().min(1).optional(),
		minPostability: z.coerce.number().int().min(0).max(100).optional(),
		sensitive: booleanQuery,
		hasAttribution: booleanQuery,
		duplicates: booleanQuery,
		sort: z
			.enum([
				"newest",
				"oldest",
				"postability",
				"takenAt",
				"rating",
				"relevance",
			])
			.default("newest"),
		cursor: z.string().trim().min(1).optional(),
		limit: z.coerce.number().int().min(1).max(200).default(60),
	})
	.refine(
		(data) => {
			if (data.sort === "relevance" && !data.q) {
				return false;
			}
			return true;
		},
		{
			message: "Sort 'relevance' is only allowed when search query 'q' is set",
			path: ["sort"],
		},
	);

export type MemeListQuery = z.input<typeof memeListQuerySchema>;
export type MemeListParsedQuery = z.output<typeof memeListQuerySchema>;

export const memePatchSchema = z.object({
	status: z.enum(MEME_STATUSES).optional(),
	rating: z.number().int().min(1).max(5).nullable().optional(),
	notes: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	altText: z.string().nullable().optional(),
	captionDraft: z.string().nullable().optional(),
	hashtags: z.array(z.string().trim().min(1)).optional(),
	template: z.string().nullable().optional(),
	tags: z.array(z.string().trim().min(1)).optional(),
	creditText: z.string().nullable().optional(),
	duplicateOfId: z.string().uuid().nullable().optional(),
});

export type MemePatchInput = z.infer<typeof memePatchSchema>;

export const memeBulkSchema = z.object({
	ids: z.array(z.string().uuid()).min(1).max(500),
	action: z.enum([
		"approve",
		"reject",
		"archive",
		"tag",
		"untag",
		"analyze",
		"attribute",
	]),
	tag: z.string().trim().min(1).optional(),
});

export type MemeBulkInput = z.infer<typeof memeBulkSchema>;
