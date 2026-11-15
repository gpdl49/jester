import { z } from "zod";
import { publishPost } from "@/lib/instagram/publish";
import { defineJob } from "@/lib/jobs/define";

/**
 * `instagram.publish` (docs/jester.md "Jobs").
 * Publishes a queued post to Instagram via Meta Graph API with container polling,
 * rate limit deferral, and double-post protection.
 */
export const instagramPublish = defineJob({
	name: "instagram.publish",
	schema: z.object({ postId: z.uuid() }),
	queue: {
		retryLimit: 2,
		retryDelay: 120,
		retryBackoff: true,
		// One waiting and one active job per postId (singletonKey), so the
		// scheduler tick cannot pile up duplicates while the worker is busy.
		policy: "stately",
	},
	handler: async (data) => {
		await publishPost(data.postId);
	},
});
