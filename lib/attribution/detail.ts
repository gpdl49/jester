import "server-only";
import type {
	AnalysisDto,
	AttributionCandidateDto,
	MemeDetailDto,
	MemeSummaryDto,
	Quality,
	Sensitivity,
	TagDto,
	UserRefDto,
} from "@/lib/api/types";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";

/**
 * Minimal local implementation of getMemeDetail(id) for the attribution slice,
 * until the library slice's lib/memes/service.ts is merged.
 */
export async function getMemeDetail(id: string): Promise<MemeDetailDto> {
	const meme = await db().meme.findUnique({
		where: { id },
		include: {
			tags: {
				include: { tag: true },
			},
			analyses: {
				orderBy: { createdAt: "desc" },
			},
			candidates: {
				orderBy: { rank: "asc" },
			},
			attribution: true,
			immichAsset: {
				select: { immichId: true },
			},
			duplicates: {
				include: {
					tags: { include: { tag: true } },
					postItems: {
						include: { post: true },
						where: { post: { status: { not: "cancelled" } } },
						take: 1,
					},
				},
			},
			postItems: {
				include: { post: true },
			},
		},
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	let approvedBy: UserRefDto | null = null;
	if (meme.approvedById) {
		const user = await db().user.findUnique({
			where: { id: meme.approvedById },
			select: { id: true, email: true, username: true },
		});
		if (user) {
			approvedBy = {
				id: user.id,
				email: user.email,
				username: user.username,
			};
		}
	}

	const mapSummary = (m: typeof meme): MemeSummaryDto => {
		const mPost = m.postItems?.find((item) => item.post.status !== "cancelled");
		return {
			id: m.id,
			source: m.source,
			status: m.status,
			width: m.width,
			height: m.height,
			blurhash: m.blurhash,
			takenAt: m.takenAt?.toISOString() ?? null,
			description: m.description,
			template: m.template,
			postability: m.postability,
			rating: m.rating,
			tags: (m.tags ?? []).map((t) => ({
				name: t.tag.name,
				kind: t.tag.kind,
				source: t.source,
			})) satisfies TagDto[],
			sensitivity: (m.sensitivity as Sensitivity | null) ?? null,
			hasAttribution: Boolean(m.attributionId),
			creditText: m.creditText,
			duplicateOfId: m.duplicateOfId,
			renditionsReady: m.renditionsReady,
			postId: mPost?.postId ?? null,
			postStatus: mPost?.post.status ?? null,
			thumbUrl: `/api/memes/${m.id}/media/thumb`,
			createdAt: m.createdAt.toISOString(),
			updatedAt: m.updatedAt.toISOString(),
		};
	};

	const candidateDtos: AttributionCandidateDto[] = meme.candidates.map((c) => ({
		id: c.id,
		memeId: c.memeId,
		creatorName: c.creatorName,
		handle: c.handle,
		platform: c.platform,
		url: c.url,
		evidence: c.evidence,
		confidence: c.confidence,
		rank: c.rank,
		confirmedAt: c.confirmedAt?.toISOString() ?? null,
		rejectedAt: c.rejectedAt?.toISOString() ?? null,
		createdAt: c.createdAt.toISOString(),
	}));

	const attributionDto: AttributionCandidateDto | null = meme.attribution
		? {
				id: meme.attribution.id,
				memeId: meme.attribution.memeId,
				creatorName: meme.attribution.creatorName,
				handle: meme.attribution.handle,
				platform: meme.attribution.platform,
				url: meme.attribution.url,
				evidence: meme.attribution.evidence,
				confidence: meme.attribution.confidence,
				rank: meme.attribution.rank,
				confirmedAt: meme.attribution.confirmedAt?.toISOString() ?? null,
				rejectedAt: meme.attribution.rejectedAt?.toISOString() ?? null,
				createdAt: meme.attribution.createdAt.toISOString(),
			}
		: null;

	const analysisDtos: AnalysisDto[] = meme.analyses.map((a) => ({
		id: a.id,
		memeId: a.memeId,
		kind: a.kind,
		model: a.model,
		status: a.status,
		result: a.result,
		error: a.error,
		costUsd: a.costUsd,
		createdAt: a.createdAt.toISOString(),
		updatedAt: a.updatedAt.toISOString(),
	}));

	return {
		...mapSummary(meme),
		contentType: meme.contentType,
		size: meme.size,
		sha256: meme.sha256,
		ocrText: meme.ocrText,
		altText: meme.altText,
		language: meme.language,
		era: meme.era,
		captionDraft: meme.captionDraft,
		hashtags: meme.hashtags,
		quality: (meme.quality as Quality | null) ?? null,
		notes: meme.notes,
		userEdited: meme.userEdited,
		immichId: meme.immichAsset?.immichId ?? null,
		approvedBy,
		approvedAt: meme.approvedAt?.toISOString() ?? null,
		analyses: analysisDtos,
		candidates: candidateDtos,
		attribution: attributionDto,
		duplicates: (meme.duplicates ?? []).map((d) =>
			mapSummary(d as typeof meme),
		),
		posts: meme.postItems.map((item) => ({
			id: item.post.id,
			accountId: item.post.accountId,
			kind: item.post.kind,
			status: item.post.status,
			caption: item.post.caption,
			queuePosition: null,
			scheduledAt: item.post.scheduledAt?.toISOString() ?? null,
			publishedAt: item.post.publishedAt?.toISOString() ?? null,
			permalink: item.post.permalink,
			error: item.post.error,
			thumbUrl: `/api/memes/${meme.id}/media/thumb`,
			itemCount: 1,
			createdAt: item.post.createdAt.toISOString(),
			updatedAt: item.post.updatedAt.toISOString(),
		})),
		displayUrl: `/api/memes/${meme.id}/media/display`,
		originalUrl: `/api/memes/${meme.id}/media/original`,
	};
}
