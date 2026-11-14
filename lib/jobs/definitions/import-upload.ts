import { z } from "zod";
import { defineJob, PermanentJobError } from "@/lib/jobs/define";

/**
 * `import.upload` (docs/memes.md "Jobs"). Owned by the `media` slice: replace the
 * handler body; keep the name and payload schema (they are the contract).
 */
export const importUpload = defineJob({
	name: "import.upload",
	schema: z.object({ uploadId: z.uuid() }),
	queue: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
	handler: async (_data) => {
		throw new PermanentJobError("import.upload: not implemented");
	},
});
