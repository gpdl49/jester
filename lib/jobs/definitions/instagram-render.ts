import { z } from "zod";
import { renderPost } from "@/lib/instagram/render";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `instagram.render` (docs/jester.md "Jobs").
 * Renders each item in the post to 1080px wide JPEGs clamped to [4:5, 1.91:1]
 * with edge-median padding, stored at `ig/<postId>/<position>.jpg`.
 */
export const instagramRender = defineJob({
	name: "instagram.render",
	schema: z.object({ postId: z.uuid() }),
	queue: { retryLimit: 2, retryDelay: 30 },
	handler: async (data) => {
		try {
			await renderPost(data.postId);
		} catch (err) {
			if (err instanceof Error && err.message.includes("not found")) {
				throw new PermanentJobError(err.message);
			}
			throw err;
		}
	},
});
