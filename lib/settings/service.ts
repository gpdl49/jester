import { z } from "zod";
import type { SettingsDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { requireAdmin, type Viewer } from "@/lib/auth";
import {
	getSettings,
	type SettingKey,
	setSettings,
	settingSchemas,
} from "@/lib/settings";

export { defaultSettings, getSetting, getSettings } from "@/lib/settings";

export type SettingChange = {
	from: unknown;
	to: unknown;
};

/**
 * Updates settings with admin authorization, persists changes,
 * audits the modification with old -> new values, and returns the full updated settings.
 */
export async function updateSettings(
	patch: Partial<SettingsDto>,
	actor: Viewer,
): Promise<SettingsDto> {
	requireAdmin(actor);

	// Own keys only: "constructor" or "toString" must be a 400, not a TypeError.
	const unknown = Object.keys(patch).filter(
		(key) => !Object.hasOwn(settingSchemas, key),
	);
	if (unknown.length > 0) {
		throw new z.ZodError(
			unknown.map((key) => ({
				code: "custom" as const,
				path: [key],
				message: "Unknown setting",
				input: (patch as Record<string, unknown>)[key],
			})),
		);
	}

	const oldSettings = await getSettings();
	const updatedSettings = await setSettings(patch, actor.id);

	const changes: Record<string, SettingChange> = {};
	for (const key of Object.keys(patch)) {
		const k = key as SettingKey;
		const oldVal = oldSettings[k];
		const newVal = updatedSettings[k];
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			changes[k] = { from: oldVal, to: newVal };
		}
	}

	if (Object.keys(changes).length > 0) {
		await audit({
			actorId: actor.id,
			action: "settings.update",
			subjectType: "setting",
			subjectId: null,
			data: { changes },
		});
	}

	return updatedSettings;
}
