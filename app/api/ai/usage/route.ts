import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/http/handler";
import { getAiUsageByDay } from "@/lib/stats/usage";

const querySchema = z.object({
	days: z.coerce.number().int().min(1).max(365).default(30),
});

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, querySchema);
	const usage = await getAiUsageByDay(query.days);
	return Response.json(usage);
});
