import { noContent, parseBody, withAuth } from "@/lib/http/handler";
import { reorderPostsSchema } from "@/lib/posts/schema";
import { reorderPosts } from "@/lib/posts/service";

export const POST = withAuth(async (request) => {
	const body = await parseBody(request, reorderPostsSchema);
	await reorderPosts(body.ids);
	return noContent();
});
