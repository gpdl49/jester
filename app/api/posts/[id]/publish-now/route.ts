import { type RouteParams, withAuth } from "@/lib/http/handler";
import { publishNow } from "@/lib/posts/service";

export const POST = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }, user) => {
		const { id } = await params;
		const post = await publishNow(id, user.id);
		return Response.json(post, { status: 202 });
	},
);
