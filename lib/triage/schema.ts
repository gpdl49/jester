import { z } from "zod";
import { TRIAGE_STATUSES, type TriageResult } from "@/lib/api/types";

export const triageKindSchema = z.enum([
	"meme",
	"reaction_image",
	"comic",
	"social_screenshot",
	"chat_screenshot",
	"other_screenshot",
	"photo",
	"document",
	"other",
]);

export const triageResultSchema = z.object({
	memeProbability: z.number().transform((val) => Math.max(0, Math.min(1, val))),
	kind: triageKindSchema,
	reason: z.string().trim().min(1),
}) satisfies z.ZodType<TriageResult>;

export const triageQuerySchema = z.object({
	status: z.enum(TRIAGE_STATUSES).optional().default("scored"),
	minProbability: z.coerce.number().min(0).max(1).optional(),
	cursor: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type TriageQuery = z.infer<typeof triageQuerySchema>;

export const triageDecisionItemSchema = z.object({
	immichAssetId: z.string().uuid(),
	decision: z.enum(["accept", "reject"]),
});

export const triageDecisionsSchema = z.object({
	decisions: z.array(triageDecisionItemSchema).min(1).max(200),
});

export type TriageDecisionsInput = z.infer<typeof triageDecisionsSchema>;

export const triageAcceptAboveSchema = z.object({
	minProbability: z.number().min(0).max(1),
});

export type TriageAcceptAboveInput = z.infer<typeof triageAcceptAboveSchema>;
