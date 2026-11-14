import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `analysis.meme` (docs/memes.md "Jobs"). Owned by the `analysis` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const analysisMeme = defineJob({
	name: "analysis.meme",
	schema: z.object({ memeId: z.uuid(), analysisId: z.uuid().optional() }),
	concurrency: 3,
	queue: { retryLimit: 1, retryDelay: 120 },
	handler: async (_data) => {
		throw new PermanentJobError("analysis.meme: not implemented");
	},
});
