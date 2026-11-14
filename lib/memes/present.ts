import type {
	AnalysisDto,
	AttributionCandidateDto,
	MemeDetailDto,
	MemeSummaryDto,
	PostSummaryDto,
	Quality,
	Sensitivity,
	TagDto,
	UserRefDto,
} from "@/lib/api/types";
import type {
	Analysis,
	AttributionCandidate,
	Meme,
	MemeTag,
	Post,
	PostItem,
	Tag,
} from "@/lib/generated/prisma/client";

export type MemeWithRelations = Meme & {
	tags?: (MemeTag & { tag: Tag })[];
	postItems?: (PostItem & { post: Post })[];
};

export type MemeDetailWithRelations = Meme & {
	tags?: (MemeTag & { tag: Tag })[];
	postItems?: (PostItem & {
		post: Post & { items?: { memeId: string; position: number }[] };
	})[];
	immichAsset?: { immichId: string } | null;
	analyses?: Analysis[];
	candidates?: AttributionCandidate[];
	attribution?: AttributionCandidate | null;
	duplicates?: (Meme & {
		tags?: (MemeTag & { tag: Tag })[];
		postItems?: (PostItem & { post: Post })[];
	})[];
	approvedUser?: UserRefDto | null;
};

export function presentAnalysis(analysis: Analysis): AnalysisDto {
	return {
		id: analysis.id,
		memeId: analysis.memeId,
		kind: analysis.kind,
		model: analysis.model,
		status: analysis.status,
		result: analysis.result,
		error: analysis.error,
		costUsd: analysis.costUsd,
		createdAt: analysis.createdAt.toISOString(),
		updatedAt: analysis.updatedAt.toISOString(),
	};
}

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

export function presentPostSummary(
	post: Post & { items?: { memeId: string; position: number }[] },
): PostSummaryDto {
	const sortedItems = post.items
		? [...post.items].sort((a, b) => a.position - b.position)
		: [];
	const firstMemeId = sortedItems[0]?.memeId;
	return {
		id: post.id,
		accountId: post.accountId,
		kind: post.kind,
		status: post.status,
		caption: post.caption,
		queuePosition: post.queuePosition,
		scheduledAt: post.scheduledAt?.toISOString() ?? null,
		publishedAt: post.publishedAt?.toISOString() ?? null,
		permalink: post.permalink,
		error: post.error,
		thumbUrl: firstMemeId ? `/api/memes/${firstMemeId}/media/thumb` : null,
		itemCount: sortedItems.length,
		createdAt: post.createdAt.toISOString(),
		updatedAt: post.updatedAt.toISOString(),
	};
}

export function presentMemeSummary(row: MemeWithRelations): MemeSummaryDto {
	// A meme can be in at most one non-cancelled post.
	const activePostItem = row.postItems?.find(
		(item) => item.post.status !== "cancelled",
	);

	const tags: TagDto[] = (row.tags ?? []).map((mt) => ({
		name: mt.tag.name,
		kind: mt.tag.kind,
		source: mt.source,
	}));

	return {
		id: row.id,
		source: row.source,
		status: row.status,
		width: row.width,
		height: row.height,
		blurhash: row.blurhash,
		takenAt: row.takenAt?.toISOString() ?? null,
		description: row.description,
		template: row.template,
		postability: row.postability,
		rating: row.rating,
		tags,
		sensitivity: (row.sensitivity as Sensitivity | null) ?? null,
		hasAttribution: Boolean(row.attributionId),
		creditText: row.creditText,
		duplicateOfId: row.duplicateOfId,
		renditionsReady: row.renditionsReady,
		postId: activePostItem?.postId ?? null,
		postStatus: activePostItem?.post.status ?? null,
		thumbUrl: `/api/memes/${row.id}/media/thumb`,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function presentMemeDetail(row: MemeDetailWithRelations): MemeDetailDto {
	const summary = presentMemeSummary(row);

	const analyses = (row.analyses ?? []).map(presentAnalysis);
	const candidates = (row.candidates ?? []).map(presentAttributionCandidate);
	const attribution = row.attribution
		? presentAttributionCandidate(row.attribution)
		: null;
	const duplicates = (row.duplicates ?? []).map((d) => presentMemeSummary(d));

	const posts = (row.postItems ?? []).map((item) =>
		presentPostSummary(item.post),
	);

	return {
		...summary,
		contentType: row.contentType,
		size: row.size,
		sha256: row.sha256,
		ocrText: row.ocrText,
		altText: row.altText,
		language: row.language,
		era: row.era,
		captionDraft: row.captionDraft,
		hashtags: row.hashtags,
		quality: (row.quality as Quality | null) ?? null,
		notes: row.notes,
		userEdited: row.userEdited,
		immichId: row.immichAsset?.immichId ?? null,
		approvedBy: row.approvedUser ?? null,
		approvedAt: row.approvedAt?.toISOString() ?? null,
		analyses,
		candidates,
		attribution,
		duplicates,
		posts,
		displayUrl: `/api/memes/${row.id}/media/display`,
		originalUrl: `/api/memes/${row.id}/media/original`,
	};
}
