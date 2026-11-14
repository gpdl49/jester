import { type RouteParams, withAuth } from "@/lib/http/handler";
import { getUpload } from "@/lib/media/service";

export const GET = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }, user) => {
		const { id } = await params;
		const upload = await getUpload(id, user);
		return Response.json(upload);
	},
);
