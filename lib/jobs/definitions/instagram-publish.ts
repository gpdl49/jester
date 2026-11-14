import { z } from "zod";
import { publishPost } from "@/lib/instagram/publish";
import { defineJob } from "@/lib/jobs/define";

/**
 * `instagram.publish` (docs/memes.md "Jobs").
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
		policy: "singleton",
	},
	handler: async (data) => {
		await publishPost(data.postId);
	},
});
