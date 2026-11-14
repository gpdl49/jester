import { parseQuery, withAuth } from "@/lib/http/handler";
import { triageQuerySchema } from "@/lib/triage/schema";
import { listTriageCandidates } from "@/lib/triage/service";

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, triageQuerySchema);
	const result = await listTriageCandidates(query);
	return Response.json(result);
});
