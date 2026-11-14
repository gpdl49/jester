import type { AttributionCandidateDto } from "@/lib/api/types";
import type { AttributionCandidate } from "@/lib/generated/prisma/client";

/**
 * The one presenter for AttributionCandidateDto: the meme detail
 * (lib/memes/present.ts) reuses it, so every endpoint returns the same shape.
 */
export function presentAttributionCandidate(
	candidate: AttributionCandidate,
): AttributionCandidateDto {
	return {
		id: candidate.id,
		memeId: candidate.memeId,
		creatorName: candidate.creatorName,
		handle: candidate.handle,
		platform: candidate.platform,
		url: candidate.url,
		evidence: candidate.evidence,
		confidence: candidate.confidence,
		rank: candidate.rank,
		confirmedAt: candidate.confirmedAt?.toISOString() ?? null,
		rejectedAt: candidate.rejectedAt?.toISOString() ?? null,
		createdAt: candidate.createdAt.toISOString(),
	};
}
