import { type RouteParams, withAuth } from "@/lib/http/handler";
import { accountIdParamsSchema } from "@/lib/instagram/schema";
import { getAccountLimit } from "@/lib/instagram/service";

export const GET = withAuth(
	async (_request, { params }: RouteParams<{ id: string }>) => {
		const { id } = accountIdParamsSchema.parse(await params);
		const limit = await getAccountLimit(id);
		return Response.json(limit);
	},
);
