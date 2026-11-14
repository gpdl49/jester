import { z } from "zod";

export const createPostSchema = z.object({
	memeIds: z
		.array(z.string().uuid())
		.min(1, "Post requires at least 1 meme")
		.max(10, "Post can have at most 10 memes"),
	caption: z.string().optional(),
	accountId: z.string().uuid().nullable().optional(),
	scheduledAt: z.coerce.date().nullable().optional(),
	status: z.enum(["draft", "queued"]).default("draft"),
});

export const patchPostSchema = z.object({
	caption: z.string().optional(),
	memeIds: z
		.array(z.string().uuid())
		.min(1, "Post requires at least 1 meme")
		.max(10, "Post can have at most 10 memes")
		.optional(),
	scheduledAt: z.coerce.date().nullable().optional(),
	status: z.enum(["draft", "queued", "cancelled"]).optional(),
	altTexts: z.array(z.string().nullable()).max(10).optional(),
});

export const reorderPostsSchema = z.object({
	ids: z.array(z.string().uuid()),
});

export const listPostsQuerySchema = z.object({
	status: z
		.enum(["draft", "queued", "publishing", "published", "failed", "cancelled"])
		.optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});
