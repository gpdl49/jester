import { z } from "zod";
import { defineJob } from "@/lib/jobs/define";
import { runSchedulerTick } from "@/lib/schedule/tick";

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
		await runSchedulerTick();
	},
});
