import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `media.renditions` (docs/memes.md "Jobs"). Owned by the `media` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const mediaRenditions = defineJob({
	name: "media.renditions",
	schema: z.object({ memeId: z.uuid() }),
	concurrency: 2,
	queue: { retryLimit: 3, retryDelay: 30 },
	handler: async (_data) => {
		throw new PermanentJobError("media.renditions: not implemented");
	},
});
