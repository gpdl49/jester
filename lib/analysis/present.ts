import type { AnalysisDto } from "@/lib/api/types";
import type { Analysis } from "@/lib/generated/prisma/client";

/**
 * Transforms an Analysis database row into an AnalysisDto.
 */
export function presentAnalysis(row: Analysis): AnalysisDto {
	return {
		id: row.id,
		memeId: row.memeId,
		kind: row.kind,
		model: row.model,
		status: row.status,
		result: row.result,
		error: row.error,
		costUsd: row.costUsd,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
