import type { SettingsDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { requireAdmin, type Viewer } from "@/lib/auth";
import { getSettings, type SettingKey, setSettings } from "@/lib/settings";

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
