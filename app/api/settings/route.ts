import { z } from "zod";
import type { SettingsDto } from "@/lib/api/types";
import { parseBody, withAuth } from "@/lib/http/handler";
import { getSettings, updateSettings } from "@/lib/settings/service";

const patchBodySchema = z.record(z.string(), z.unknown());

export const GET = withAuth(async () => {
	const settings = await getSettings();
	return Response.json(settings);
});

export const PATCH = withAuth(async (request, _context, user) => {
	const body = await parseBody(request, patchBodySchema);
	const updated = await updateSettings(body as Partial<SettingsDto>, user);
	return Response.json(updated);
});
