import { withAuth } from "@/lib/http/handler";
import { getTagCounts } from "@/lib/tags/service";

export const GET = withAuth(async () => {
	const tags = await getTagCounts();
	return Response.json(tags);
});
