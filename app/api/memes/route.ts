import { parseQuery, withAuth } from "@/lib/http/handler";
import { memeListQuerySchema } from "@/lib/memes/schema";
import { listMemes } from "@/lib/memes/service";

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, memeListQuerySchema);
	const result = await listMemes(query);
	return Response.json(result);
});
