import { z } from "zod";
import type { SettingsDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Runtime settings admins change in the UI (docs/jester.md "App
 * environment"). Stored one row per key in `settings`; a missing row means
 * the default. The schemas are the contract; the `admin` slice owns the API
 * and UI on top (lib/settings/service.ts, /api/settings, /settings).
 */

export const DEFAULT_SMART_QUERIES = [
	"meme",
	"funny meme with caption text",
	"screenshot of a tweet",
	"reaction image",
	"comic strip",
	"image macro with impact font",
];

export const DEFAULT_CAPTION_TEMPLATE = "{caption}\n\n{credit}\n\n{hashtags}";
export const DEFAULT_UNKNOWN_CREDIT = "Creator unknown — DM for credit/removal";

export const settingSchemas = {
	"prefilter.threshold": z.number().min(0).max(1),
	/** null: auto-accept off (the default). */
	"triage.autoAcceptThreshold": z.number().min(0.5).max(1).nullable(),
	"immich.smartQueries": z.array(z.string().trim().min(1).max(200)).max(20),
	"caption.template": z
		.string()
		.min(1)
		.max(1000)
		.refine((t) => t.includes("{caption}"), "must contain {caption}"),
	"caption.unknownCredit": z.string().max(200),
	"ai.dailyBudgetUsd": z.number().min(0).max(100),
	"ai.paused": z.boolean(),
	"immich.deletePaused": z.boolean(),
	"publishing.paused": z.boolean(),
} satisfies { [K in keyof SettingsDto]: z.ZodType<SettingsDto[K]> };

export type SettingKey = keyof SettingsDto;

export function defaultSettings(): SettingsDto {
	return {
		"prefilter.threshold": 0.35,
		"triage.autoAcceptThreshold": null,
		"immich.smartQueries": DEFAULT_SMART_QUERIES,
		"caption.template": DEFAULT_CAPTION_TEMPLATE,
		"caption.unknownCredit": DEFAULT_UNKNOWN_CREDIT,
		"ai.dailyBudgetUsd": env().AI_DAILY_BUDGET_USD,
		"ai.paused": false,
		"immich.deletePaused": false,
		"publishing.paused": false,
	};
}

/** One setting; a stored value that no longer validates falls back to the default. */
export async function getSetting<K extends SettingKey>(
	key: K,
): Promise<SettingsDto[K]> {
	const row = await db().setting.findUnique({ where: { key } });
	if (row) {
		const parsed = settingSchemas[key].safeParse(row.value);
		if (parsed.success) {
			return parsed.data as SettingsDto[K];
		}
	}
	return defaultSettings()[key];
}

export async function getSettings(): Promise<SettingsDto> {
	const rows = await db().setting.findMany();
	const settings = defaultSettings();
	for (const row of rows) {
		const key = row.key as SettingKey;
		const schema = settingSchemas[key];
		const parsed = schema?.safeParse(row.value);
		if (parsed?.success) {
			(settings as Record<string, unknown>)[key] = parsed.data;
		}
	}
	return settings;
}

/** Validates and stores the given settings (no auth check: callers do that). */
export async function setSettings(
	patch: Partial<SettingsDto>,
	updatedById: string | null,
): Promise<SettingsDto> {
	const entries = Object.entries(patch) as [SettingKey, unknown][];
	const validated = entries.map(([key, value]) => {
		const schema = settingSchemas[key];
		if (!schema) {
			throw new z.ZodError([
				{
					code: "custom",
					path: [key],
					message: "Unknown setting",
					input: value,
				},
			]);
		}
		return [key, schema.parse(value)] as const;
	});
	await db().$transaction(
		validated.map(([key, value]) =>
			db().setting.upsert({
				where: { key },
				create: { key, value: value as object, updatedById },
				update: { value: value as object, updatedById },
			}),
		),
	);
	return getSettings();
}
