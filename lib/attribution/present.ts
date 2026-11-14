import type { AnalysisDto } from "@/lib/api/types";

export function presentAnalysis(row: {
	id: string;
	memeId: string | null;
	kind: string;
	model: string | null;
	status: string;
	result: unknown;
	error: string | null;
	costUsd: number | null;
	createdAt: Date;
	updatedAt: Date;
}): AnalysisDto {
	return {
		id: row.id,
		memeId: row.memeId,
		kind: row.kind as AnalysisDto["kind"],
		model: row.model,
		status: row.status as AnalysisDto["status"],
		result: row.result,
		error: row.error,
		costUsd: row.costUsd,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
