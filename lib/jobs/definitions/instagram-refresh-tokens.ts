import { z } from "zod";
import { refreshExpiringTokens } from "@/lib/instagram/refresh";
import { defineJob } from "@/lib/jobs/define";

/**
 * `instagram.refresh-tokens` (docs/jester.md "Jobs").
 * Daily job to refresh Instagram tokens expiring within 10 days.
 */
export const instagramRefreshTokens = defineJob({
	name: "instagram.refresh-tokens",
	schema: z.object({}),
	cron: { expression: "17 3 * * *", data: {} },
	queue: { retryLimit: 2, retryDelay: 600 },
	handler: async () => {
		await refreshExpiringTokens();
	},
});
