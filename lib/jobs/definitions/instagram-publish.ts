import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `instagram.publish` (docs/memes.md "Jobs"). Owned by the `instagram` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
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
	handler: async (_data) => {
		throw new PermanentJobError("instagram.publish: not implemented");
	},
});
