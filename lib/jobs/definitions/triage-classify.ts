import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `triage.classify` (docs/memes.md "Jobs"). Owned by the `triage` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const triageClassify = defineJob({
	name: "triage.classify",
	schema: z.object({ immichAssetId: z.uuid() }),
	concurrency: 4,
	queue: { retryLimit: 2, retryDelay: 30, retryBackoff: true },
	handler: async (_data) => {
		throw new PermanentJobError("triage.classify: not implemented");
	},
});
