import { requireAdmin } from "@/lib/auth";
import { parseBody, withAuth } from "@/lib/http/handler";
import { triageAcceptAboveSchema } from "@/lib/triage/schema";
import { acceptAbove } from "@/lib/triage/service";

export const POST = withAuth(async (request, _context, user) => {
	requireAdmin(user);
	const body = await parseBody(request, triageAcceptAboveSchema);
	const result = await acceptAbove(body.minProbability, user.id);
	return Response.json(result);
});
