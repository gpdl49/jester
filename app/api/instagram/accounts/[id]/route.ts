import { requireAdmin } from "@/lib/auth";
import { noContent, type RouteParams, withAuth } from "@/lib/http/handler";
import { accountIdParamsSchema } from "@/lib/instagram/schema";
import { deleteAccount } from "@/lib/instagram/service";

export const DELETE = withAuth(
	async (_request, { params }: RouteParams<{ id: string }>, user) => {
		requireAdmin(user);
		const { id } = accountIdParamsSchema.parse(await params);
		await deleteAccount(id, user.id);
		return noContent();
	},
);
