import {
	noContent,
	parseBody,
	type RouteParams,
	withAuth,
} from "@/lib/http/handler";
import { memePatchSchema } from "@/lib/memes/schema";
import { deleteMeme, getMemeDetail, patchMeme } from "@/lib/memes/service";

type Context = RouteParams<{ id: string }>;

export const GET = withAuth<Context>(async (_request, { params }) => {
	const { id } = await params;
	const detail = await getMemeDetail(id);
	return Response.json(detail);
});

export const PATCH = withAuth<Context>(async (request, { params }, user) => {
	const { id } = await params;
	const body = await parseBody(request, memePatchSchema);
	const detail = await patchMeme(id, body, user);
	return Response.json(detail);
});

export const DELETE = withAuth<Context>(async (_request, { params }, user) => {
	const { id } = await params;
	await deleteMeme(id, user);
	return noContent();
});
