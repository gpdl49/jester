import { withAuth } from "@/lib/http/handler";
import { getDashboardStats } from "@/lib/stats/service";

export const GET = withAuth(async () => {
	const stats = await getDashboardStats();
	return Response.json(stats);
});
