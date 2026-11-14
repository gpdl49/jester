import { requireAdmin } from "@/lib/auth";
import { parseBody, withAuth } from "@/lib/http/handler";
import { putScheduleSlotsSchema } from "@/lib/schedule/schema";
import { getScheduleSlots, updateScheduleSlots } from "@/lib/schedule/service";

export const GET = withAuth(async () => {
	const slots = await getScheduleSlots();
	return Response.json(slots);
});

export const PUT = withAuth(async (request, _context, user) => {
	requireAdmin(user);
	const body = await parseBody(request, putScheduleSlotsSchema);
	const slots = await updateScheduleSlots(body);
	return Response.json(slots);
});
