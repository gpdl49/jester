import { parseQuery, withAuth } from "@/lib/http/handler";
import { schedulePreviewQuerySchema } from "@/lib/schedule/schema";
import { getSchedulePreview } from "@/lib/schedule/service";

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, schedulePreviewQuerySchema);
	const preview = await getSchedulePreview(query.days);
	return Response.json(preview);
});
