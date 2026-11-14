import { presentAnalysis } from "@/lib/analysis/present";
import type { AnalysisDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { attributionFind } from "@/lib/jobs/definitions/attribution-find";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Thin stub for attribution request. The attribution slice will replace this.
 */
export async function requestAttribution(
	memeId: string,
	_actorId: string | null,
): Promise<AnalysisDto> {
	const analysis = await db().analysis.create({
		data: {
			memeId,
			kind: "attribution",
			status: "queued",
		},
	});
	await enqueue(attributionFind, { memeId, analysisId: analysis.id });
	return presentAnalysis(analysis);
}
