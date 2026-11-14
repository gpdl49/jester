import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `scheduler.tick` (docs/memes.md "Jobs"). Owned by the `posts` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const schedulerTick = defineJob({
	name: "scheduler.tick",
	schema: z.object({}),
	cron: { expression: "* * * * *", data: {} },
	queue: { retryLimit: 0, policy: "singleton" },
	handler: async (_data) => {
		throw new PermanentJobError("scheduler.tick: not implemented");
	},
});
