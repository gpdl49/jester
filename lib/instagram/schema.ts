import { z } from "zod";

export const accountIdParamsSchema = z.object({
	id: z.string().uuid(),
});

export const oauthCallbackQuerySchema = z.object({
	code: z.string().min(1),
	state: z.string().min(1),
	error: z.string().optional(),
	error_description: z.string().optional(),
});
