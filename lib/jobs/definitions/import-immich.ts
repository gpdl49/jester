import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `import.immich` (docs/memes.md "Jobs"). Owned by the `media` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const importImmich = defineJob({
	name: "import.immich",
	schema: z.object({ immichAssetId: z.uuid() }),
	concurrency: 2,
	queue: { retryLimit: 3, retryDelay: 60, retryBackoff: true },
	handler: async (_data) => {
		throw new PermanentJobError("import.immich: not implemented");
	},
});
