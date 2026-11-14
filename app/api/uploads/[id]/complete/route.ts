import { type RouteParams, withAuth } from "@/lib/http/handler";
import { completeUpload } from "@/lib/media/service";

export const POST = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }, user) => {
		const { id } = await params;
		const upload = await completeUpload(id, user);
		return Response.json(upload);
	},
);
