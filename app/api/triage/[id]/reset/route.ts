import { requireAdmin } from "@/lib/auth";
import { type RouteParams, withAuth } from "@/lib/http/handler";
import { resetAsset } from "@/lib/triage/service";

export const POST = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }, user) => {
		requireAdmin(user);
		const { id } = await params;
		const candidate = await resetAsset(id, user.id);
		return Response.json(candidate);
	},
);
