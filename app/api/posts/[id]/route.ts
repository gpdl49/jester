import { parseBody, type RouteParams, withAuth } from "@/lib/http/handler";
import { patchPostSchema } from "@/lib/posts/schema";
import { getPost, patchPost } from "@/lib/posts/service";

export const GET = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }) => {
		const { id } = await params;
		const post = await getPost(id);
		return Response.json(post);
	},
);

export const PATCH = withAuth<RouteParams<{ id: string }>>(
	async (request, { params }, user) => {
		const { id } = await params;
		const body = await parseBody(request, patchPostSchema);
		const post = await patchPost(id, body, user.id);
		return Response.json(post);
	},
);
