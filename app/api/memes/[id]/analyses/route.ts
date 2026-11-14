import { z } from "zod";
import { assertAiAvailable } from "@/lib/ai";
import { presentAnalysis } from "@/lib/analysis/present";
import { requestAttribution } from "@/lib/attribution/request";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, conflict, notFound } from "@/lib/http/errors";
import { type RouteParams, withAuth } from "@/lib/http/handler";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { enqueue } from "@/lib/jobs/queue";

const postAnalysesSchema = z.object({
	kind: z.enum(["meme", "attribution"]).default("meme"),
});

export const POST = withAuth<RouteParams<{ id: string }>>(
	async (request, { params }, user) => {
		let raw: unknown = {};
		try {
			const text = await request.text();
			if (text.trim().length > 0) {
				raw = JSON.parse(text);
			}
		} catch {
			throw badRequest("Body must be valid JSON");
		}
		const body = postAnalysesSchema.parse(raw);

		// 1. Assert AI availability (503 if disabled, 429 if budget exceeded)
		await assertAiAvailable();

		const { id: memeId } = await params;
		const meme = await db().meme.findUnique({
			where: { id: memeId },
		});
		if (!meme) {
			throw notFound("Meme not found");
		}

		if (body.kind === "attribution") {
			const result = await requestAttribution(memeId, user.id);
			return Response.json(result, { status: 202 });
		}

		// kind: "meme"
		const existing = await db().analysis.findFirst({
			where: {
				memeId,
				kind: "meme",
				status: { in: ["queued", "running"] },
			},
		});
		if (existing) {
			throw conflict("Meme analysis is already queued or running");
		}

		const analysis = await db().analysis.create({
			data: {
				memeId,
				kind: "meme",
				status: "queued",
				model: env().OPENROUTER_ANALYSIS_MODEL,
			},
		});

		await enqueue(analysisMeme, { memeId, analysisId: analysis.id });

		return Response.json(presentAnalysis(analysis), { status: 202 });
	},
);
