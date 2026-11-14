import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `instagram.render` (docs/memes.md "Jobs"). Owned by the `instagram` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const instagramRender = defineJob({
	name: "instagram.render",
	schema: z.object({ postId: z.uuid() }),
	queue: { retryLimit: 2, retryDelay: 30 },
	handler: async (_data) => {
		throw new PermanentJobError("instagram.render: not implemented");
	},
});
