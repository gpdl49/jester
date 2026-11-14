/**
 * HTTP API response shapes (docs/memes.md "HTTP API"). Shared by route
 * handlers (server) and lib/client (browser). Dates are ISO 8601 strings.
 * This file is a contract: slices add nothing here without the coordinator.
 */

export type Paged<T> = { items: T[]; nextCursor: string | null };

export type ErrorBody = { error: string; message: string };

// ---- Enums (mirror prisma/schema.prisma) ----

export const TRIAGE_STATUSES = [
	"unscored",
	"pending",
	"scored",
	"accepted",
	"rejected",
	"imported",
	"deleted",
	"error",
] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const MEME_STATUSES = [
	"inbox",
	"approved",
	"rejected",
	"archived",
] as const;
export type MemeStatus = (typeof MEME_STATUSES)[number];

export type MemeSource = "immich" | "upload";
export type TagKind = "topic" | "template" | "style" | "user";
export type AnalysisKind = "triage" | "meme" | "attribution";
export type AnalysisStatus = "queued" | "running" | "done" | "failed";
export const ATTRIBUTION_PLATFORMS = [
	"instagram",
	"x",
	"reddit",
	"tiktok",
	"tumblr",
	"ninegag",
	"ifunny",
	"web",
	"other",
] as const;
export type AttributionPlatform = (typeof ATTRIBUTION_PLATFORMS)[number];
export type UploadStatus = "pending" | "complete" | "imported" | "failed";
export type DeletionStatus = "pending" | "done" | "skipped" | "failed";
export type PostKind = "image" | "carousel";
export const POST_STATUSES = [
	"draft",
	"queued",
	"publishing",
	"published",
	"failed",
	"cancelled",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export type MediaVariant = "original" | "display" | "thumb";

// ---- Users ----

export type MeDto = {
	id: string;
	sub: string;
	email: string | null;
	username: string | null;
	groups: string[];
	isAdmin: boolean;
};

export type UserRefDto = {
	id: string;
	email: string | null;
	username: string | null;
};

// ---- Triage ----

export type PrefilterSignals = {
	mime?: boolean;
	filename?: boolean;
	noCamera?: boolean;
	screenDims?: boolean;
	smartHit?: boolean;
	ocrWords?: boolean;
};

/** Output of the triage model (lib/triage/schema.ts validates it). */
export type TriageResult = {
	memeProbability: number; // 0-1
	kind:
		| "meme"
		| "reaction_image"
		| "comic"
		| "social_screenshot"
		| "chat_screenshot"
		| "other_screenshot"
		| "photo"
		| "document"
		| "other";
	reason: string;
};

export type TriageCandidateDto = {
	id: string; // ImmichAsset.id
	immichId: string;
	originalFileName: string;
	mimeType: string;
	width: number | null;
	height: number | null;
	fileCreatedAt: string | null;
	prefilterScore: number;
	prefilterSignals: PrefilterSignals;
	smartHits: string[];
	triageStatus: TriageStatus;
	memeProbability: number | null;
	triageResult: TriageResult | null;
	memeId: string | null;
	error: string | null;
	/** `/api/triage/{id}/preview` */
	previewUrl: string;
};

// ---- Memes ----

export type Sensitivity = {
	nsfw: boolean;
	politics: boolean;
	slurs: boolean;
	personalData: boolean;
	notes: string | null;
};

export type Quality = {
	lowRes: boolean;
	heavyCompression: boolean;
	cropped: boolean;
	watermark: boolean;
};

export type TagDto = { name: string; kind: TagKind; source: "ai" | "user" };
export type TagCountDto = { name: string; kind: TagKind; count: number };

export type MemeSummaryDto = {
	id: string;
	source: MemeSource;
	status: MemeStatus;
	width: number | null;
	height: number | null;
	blurhash: string | null;
	takenAt: string | null;
	description: string | null;
	template: string | null;
	postability: number | null;
	rating: number | null;
	tags: TagDto[];
	sensitivity: Sensitivity | null;
	hasAttribution: boolean;
	creditText: string | null;
	duplicateOfId: string | null;
	renditionsReady: boolean;
	/** Post id when the meme is in a non-cancelled post. */
	postId: string | null;
	postStatus: PostStatus | null;
	/** `/api/memes/{id}/media/thumb` */
	thumbUrl: string;
	createdAt: string;
	updatedAt: string;
};

export type AnalysisDto = {
	id: string;
	memeId: string | null;
	kind: AnalysisKind;
	model: string | null;
	status: AnalysisStatus;
	result: unknown;
	error: string | null;
	costUsd: number | null;
	createdAt: string;
	updatedAt: string;
};

export type AttributionCandidateDto = {
	id: string;
	memeId: string;
	creatorName: string | null;
	handle: string | null;
	platform: AttributionPlatform;
	url: string | null;
	evidence: string;
	confidence: number;
	rank: number;
	confirmedAt: string | null;
	rejectedAt: string | null;
	createdAt: string;
};

export type MemeDetailDto = MemeSummaryDto & {
	contentType: string;
	size: number;
	sha256: string;
	ocrText: string | null;
	altText: string | null;
	language: string | null;
	era: string | null;
	captionDraft: string | null;
	hashtags: string[];
	quality: Quality | null;
	notes: string | null;
	userEdited: string[];
	immichId: string | null;
	approvedBy: UserRefDto | null;
	approvedAt: string | null;
	analyses: AnalysisDto[];
	candidates: AttributionCandidateDto[];
	attribution: AttributionCandidateDto | null;
	duplicates: MemeSummaryDto[];
	posts: PostSummaryDto[];
	displayUrl: string;
	originalUrl: string;
};

/** Output of the meme analysis model (lib/analysis/schema.ts validates it). */
export type MemeAnalysisResult = {
	ocrText: string;
	description: string;
	altText: string;
	template: string | null;
	language: string;
	era: string | null;
	topics: string[];
	styles: string[];
	sensitivity: Sensitivity;
	quality: Quality;
	postability: number;
	captionDraft: string;
	hashtags: string[];
	attributionClues: {
		watermarks: string[];
		handles: string[];
		sites: string[];
		subreddits: string[];
	};
};

export type MemeBulkAction =
	| "approve"
	| "reject"
	| "archive"
	| "tag"
	| "untag"
	| "analyze"
	| "attribute";

// ---- Uploads ----

export type UploadDto = {
	id: string;
	contentType: string;
	size: number;
	status: UploadStatus;
	memeId: string | null;
	error: string | null;
	createdAt: string;
};

export type UploadCreatedDto = {
	upload: UploadDto;
	uploadUrl: string;
	uploadHeaders: Record<string, string>;
};

// ---- Instagram & posts ----

export type InstagramAccountDto = {
	id: string;
	igUserId: string;
	username: string;
	tokenExpiresAt: string;
	isDefault: boolean;
	createdAt: string;
};

export type PublishingLimitDto = { used: number; total: number };

export type PostItemDto = {
	position: number;
	altText: string | null;
	meme: MemeSummaryDto;
};

export type PostSummaryDto = {
	id: string;
	accountId: string | null;
	kind: PostKind;
	status: PostStatus;
	caption: string;
	queuePosition: number | null;
	scheduledAt: string | null;
	publishedAt: string | null;
	permalink: string | null;
	error: string | null;
	/** First item's thumb. */
	thumbUrl: string | null;
	itemCount: number;
	createdAt: string;
	updatedAt: string;
};

export type PostDetailDto = PostSummaryDto & {
	items: PostItemDto[];
	attempts: number;
	igMediaId: string | null;
	/** The caption as it will be published (template applied). */
	renderedCaption: string;
	captionWarnings: string[];
	createdBy: UserRefDto | null;
};

export type ScheduleSlotDto = {
	id: string;
	accountId: string | null;
	weekday: number;
	time: string;
	enabled: boolean;
};

export type SchedulePreviewDto = { at: string; postId: string | null }[];

// ---- Settings, audit, stats ----

export type SettingsDto = {
	"prefilter.threshold": number;
	"triage.autoAcceptThreshold": number | null;
	"immich.smartQueries": string[];
	"caption.template": string;
	"caption.unknownCredit": string;
	"ai.dailyBudgetUsd": number;
	"ai.paused": boolean;
	"immich.deletePaused": boolean;
	"publishing.paused": boolean;
};

export type AuditEventDto = {
	id: string;
	actor: UserRefDto | null;
	action: string;
	subjectType: string;
	subjectId: string | null;
	data: Record<string, unknown>;
	at: string;
};

export type AiUsageDayDto = {
	day: string;
	kind: string;
	costUsd: number;
	calls: number;
};

export type DashboardStatsDto = {
	triage: Record<TriageStatus, number>;
	memes: Record<MemeStatus, number>;
	queuedPosts: number;
	nextPost: PostSummaryDto | null;
	aiSpend: { todayUsd: number; monthUsd: number; dailyBudgetUsd: number };
	sync: {
		lastRunAt: string | null;
		lastError: string | null;
		backfillDone: boolean;
		backfillPage: number;
		assetsSeen: number;
	};
	features: {
		ai: boolean;
		immich: boolean;
		immichDelete: boolean;
		instagram: boolean;
	};
};
