import { withAuth } from "@/lib/http/handler";
import { listAccounts } from "@/lib/instagram/service";

export const GET = withAuth(async () => {
	const accounts = await listAccounts();
	return Response.json(accounts);
});
