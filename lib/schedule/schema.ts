import { z } from "zod";

export const scheduleSlotItemSchema = z.object({
	id: z.string().uuid().optional(),
	accountId: z.string().uuid().nullable().optional(),
	weekday: z.number().int().min(0).max(6),
	time: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:MM format"),
	enabled: z.boolean().default(true),
});

export const putScheduleSlotsSchema = z.array(scheduleSlotItemSchema);

export const schedulePreviewQuerySchema = z.object({
	days: z.coerce.number().int().min(1).max(60).default(14),
});
