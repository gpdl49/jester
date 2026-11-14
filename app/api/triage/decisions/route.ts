import { parseBody, withAuth } from "@/lib/http/handler";
import { triageDecisionsSchema } from "@/lib/triage/schema";
import { decideAssets } from "@/lib/triage/service";

export const POST = withAuth(async (request, _context, user) => {
	const body = await parseBody(request, triageDecisionsSchema);
	const result = await decideAssets(body.decisions, user.id);
	return Response.json(result);
});
