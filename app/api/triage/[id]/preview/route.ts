import { type RouteParams, withAuth } from "@/lib/http/handler";
import { getThumbnailBytes } from "@/lib/triage/service";

export const GET = withAuth<RouteParams<{ id: string }>>(
	async (_request, { params }) => {
		const { id } = await params;
		const thumb = await getThumbnailBytes(id);
		return new Response(Buffer.from(thumb.bytes), {
			status: 200,
			headers: {
				"Content-Type": thumb.contentType,
				"Cache-Control": "private, max-age=3600",
			},
		});
	},
);
