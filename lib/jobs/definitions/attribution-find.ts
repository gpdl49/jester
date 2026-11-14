import { z } from "zod";
import { BudgetExceededError, nextBudgetReset } from "@/lib/ai";
import { runAttribution } from "@/lib/attribution/find";
import { defineJob } from "@/lib/jobs/define";
import { enqueue } from "@/lib/jobs/queue";

/**
 * `attribution.find` (docs/memes.md "Jobs"). Owned by the `attribution` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const attributionFind = defineJob({
	name: "attribution.find",
	schema: z.object({ memeId: z.uuid(), analysisId: z.uuid().optional() }),
	concurrency: 2,
	queue: { retryLimit: 0 },
	handler: async (data) => {
		try {
			await runAttribution(data.memeId, data.analysisId);
		} catch (err) {
			if (err instanceof BudgetExceededError) {
				await enqueue(attributionFind, data, {
					startAfter: nextBudgetReset(),
				});
				return;
			}
			throw err;
		}
	},
});
