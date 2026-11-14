import { z } from "zod";

export const createUploadSchema = z.object({
	contentType: z.string(),
	size: z.number().int(),
});

export type CreateUploadInput = z.infer<typeof createUploadSchema>;
