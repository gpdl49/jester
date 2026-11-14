import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `attribution.find` (docs/memes.md "Jobs"). Owned by the `attribution` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const attributionFind = defineJob({
	name: "attribution.find",
	schema: z.object({ memeId: z.uuid(), analysisId: z.uuid().optional() }),
	concurrency: 2,
	queue: { retryLimit: 0 },
	handler: async (_data) => {
		throw new PermanentJobError("attribution.find: not implemented");
	},
});
