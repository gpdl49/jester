import { parseBody, parseQuery, withAuth } from "@/lib/http/handler";
import { createPostSchema, listPostsQuerySchema } from "@/lib/posts/schema";
import { createPost, listPosts } from "@/lib/posts/service";

export const GET = withAuth(async (request) => {
	const query = parseQuery(request, listPostsQuerySchema);
	const result = await listPosts(query);
	return Response.json(result);
});

export const POST = withAuth(async (request, _context, user) => {
	const body = await parseBody(request, createPostSchema);
	const post = await createPost(body, user.id);
	return Response.json(post, { status: 201 });
});
