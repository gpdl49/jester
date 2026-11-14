import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `immich.scan` (docs/memes.md "Jobs"). Owned by the `immich` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const immichScan = defineJob({
	name: "immich.scan",
	schema: z.object({
		mode: z.enum(["backfill", "incremental"]).default("incremental"),
	}),
	cron: {
		expression: "*/{IMMICH_SYNC_INTERVAL_MINUTES} * * * *",
		data: { mode: "incremental" },
	},
	queue: { retryLimit: 0, policy: "singleton" },
	handler: async (_data) => {
		throw new PermanentJobError("immich.scan: not implemented");
	},
});
