import { requireAdmin } from "@/lib/auth";
import { type RouteParams, withAuth } from "@/lib/http/handler";
import { accountIdParamsSchema } from "@/lib/instagram/schema";
import { setDefaultAccount } from "@/lib/instagram/service";

export const POST = withAuth(
	async (_request, { params }: RouteParams<{ id: string }>, user) => {
		requireAdmin(user);
		const { id } = accountIdParamsSchema.parse(await params);
		const updated = await setDefaultAccount(id, user.id);
		return Response.json(updated);
	},
);
