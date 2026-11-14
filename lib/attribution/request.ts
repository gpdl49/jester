import "server-only";
import { assertAiAvailable } from "@/lib/ai";
import type { AnalysisDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { conflict, notFound } from "@/lib/http/errors";
import { attributionFind } from "@/lib/jobs/definitions/attribution-find";
import { enqueue } from "@/lib/jobs/queue";
import { presentAnalysis } from "./present";

/**
 * Creates a queued attribution analysis, enqueues the attribution.find job,
 * and records an audit event.
 * Signature defined in docs/contract.md "Cross-slice exports".
 */
export async function requestAttribution(
	memeId: string,
	actorId: string | null,
): Promise<AnalysisDto> {
	const meme = await db().meme.findUnique({
		where: { id: memeId },
		select: { id: true },
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	// 409 if an attribution analysis is already queued or running
	const existing = await db().analysis.findFirst({
		where: {
			memeId,
			kind: "attribution",
			status: { in: ["queued", "running"] },
		},
	});

	if (existing) {
		throw conflict(
			"An attribution analysis is already in progress for this meme",
		);
	}

	// Verify AI is available (throws 503 if unconfigured/paused, 429 if budget exceeded)
	await assertAiAvailable();

	const analysis = await db().analysis.create({
		data: {
			memeId,
			kind: "attribution",
			status: "queued",
			model: env().OPENROUTER_ATTRIBUTION_MODEL,
		},
	});

	await enqueue(attributionFind, { memeId, analysisId: analysis.id });

	await audit({
		actorId,
		action: "attribution.request",
		subjectType: "meme",
		subjectId: memeId,
		data: { analysisId: analysis.id },
	});

	return presentAnalysis(analysis);
}
