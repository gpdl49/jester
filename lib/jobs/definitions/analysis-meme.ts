import { z } from "zod";
import { runMemeAnalysis } from "@/lib/analysis/run";
import { defineJob } from "@/lib/jobs/define";

/**
 * `analysis.meme` (docs/memes.md "Jobs"). Owned by the `analysis` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const analysisMeme = defineJob({
	name: "analysis.meme",
	schema: z.object({ memeId: z.uuid(), analysisId: z.uuid().optional() }),
	concurrency: 3,
	queue: { retryLimit: 1, retryDelay: 120 },
	handler: async ({ memeId, analysisId }) => {
		await runMemeAnalysis(memeId, analysisId);
	},
});
