import { z } from "zod";
import { defineJob } from "@/lib/jobs/define";

/**
 * `triage.classify` (docs/jester.md "Jobs"). Owned by the `triage` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const triageClassify = defineJob({
	name: "triage.classify",
	schema: z.object({ immichAssetId: z.uuid() }),
	concurrency: 4,
	queue: { retryLimit: 2, retryDelay: 30, retryBackoff: true },
	handler: async ({ immichAssetId }, job) => {
		const { runTriage } = await import("@/lib/triage/classify");
		const retryCount =
			(job as { retryCount?: number } | undefined)?.retryCount ?? 0;
		const retryLimit = triageClassify.queue?.retryLimit ?? 2;
		await runTriage(immichAssetId, { retryCount, retryLimit });
	},
});
