import { z } from "zod";
import { listAuditEvents } from "@/lib/audit/list";
import { parseQuery, withAuth } from "@/lib/http/handler";

const querySchema = z.object({
	cursor: z.string().optional(),
	action: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, querySchema);
	const result = await listAuditEvents(query);
	return Response.json(result);
});
