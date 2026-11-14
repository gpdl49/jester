import { parseBody, withAuth } from "@/lib/http/handler";
import { memeBulkSchema } from "@/lib/memes/schema";
import { bulkMemes } from "@/lib/memes/service";

export const POST = withAuth(async (request, _context, user) => {
	const body = await parseBody(request, memeBulkSchema);
	const result = await bulkMemes(body, user);
	return Response.json(result);
});
