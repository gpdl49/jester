import { z } from "zod";
import { runDelete } from "@/lib/immich/delete";
import { defineJob } from "@/lib/jobs/define";

/**
 * `immich.delete` (docs/memes.md "Jobs"). Owned by the `immich` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const immichDelete = defineJob({
	name: "immich.delete",
	schema: z.object({ immichAssetId: z.uuid() }),
	queue: { retryLimit: 5, retryDelay: 60, retryBackoff: true },
	handler: async (data) => {
		await runDelete(data.immichAssetId);
	},
});
