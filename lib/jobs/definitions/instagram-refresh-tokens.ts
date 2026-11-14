import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `instagram.refresh-tokens` (docs/memes.md "Jobs"). Owned by the `instagram` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const instagramRefreshTokens = defineJob({
	name: "instagram.refresh-tokens",
	schema: z.object({}),
	cron: { expression: "17 3 * * *", data: {} },
	queue: { retryLimit: 2, retryDelay: 600 },
	handler: async (_data) => {
		throw new PermanentJobError("instagram.refresh-tokens: not implemented");
	},
});
