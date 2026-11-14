import { z } from "zod";
import { rejectAttribution } from "@/lib/attribution/service";
import { badRequest } from "@/lib/http/errors";
import { type RouteParams, withAuth } from "@/lib/http/handler";

const paramsSchema = z.object({
	id: z.string().uuid(),
	candidateId: z.string().uuid(),
});

type Context = RouteParams<{ id: string; candidateId: string }>;

export const POST = withAuth<Context>(async (_request, context, user) => {
	const rawParams = await context.params;
	const parsed = paramsSchema.safeParse(rawParams);
	if (!parsed.success) {
		throw badRequest("Invalid meme or candidate ID");
	}

	const meme = await rejectAttribution(
		parsed.data.id,
		parsed.data.candidateId,
		user.id,
	);
	return Response.json(meme);
});
