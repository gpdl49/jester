import { type RouteParams, withAuth } from "@/lib/http/handler";
import { getMediaRedirectUrl } from "@/lib/media/service";

export const GET = withAuth<RouteParams<{ id: string; variant: string }>>(
	async (_request, { params }) => {
		const { id, variant } = await params;
		const url = await getMediaRedirectUrl(id, variant);
		return new Response(null, {
			status: 302,
			headers: {
				Location: url,
				"Cache-Control": "private, max-age=300",
			},
		});
	},
);
