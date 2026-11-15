import { z } from "zod";
import { defineJob } from "@/lib/jobs/define";
import { generateRenditions } from "@/lib/media/renditions";

/**
 * `media.renditions` (docs/jester.md "Jobs"). Owned by the `media` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const mediaRenditions = defineJob({
	name: "media.renditions",
	schema: z.object({ memeId: z.uuid() }),
	concurrency: 2,
	queue: { retryLimit: 3, retryDelay: 30 },
	handler: async (data) => {
		await generateRenditions(data.memeId);
	},
});
