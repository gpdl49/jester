import { z } from "zod";

export const accountIdParamsSchema = z.object({
	id: z.string().uuid(),
});

export const oauthCallbackQuerySchema = z.object({
	code: z.string().min(1).optional(),
	state: z.string().min(1).optional(),
	error: z.string().optional(),
	error_description: z.string().optional(),
});
