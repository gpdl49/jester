import type { AnalysisDto } from "@/lib/api/types";

/**
 * Cross-slice contract owned by the `attribution` slice (docs/contract.md).
 * Minimal stub created by the `library` slice until `attribution` is merged.
 */
export async function requestAttribution(
	_memeId: string,
	_actorId: string | null,
): Promise<AnalysisDto> {
	throw new Error("not implemented");
}
