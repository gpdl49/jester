import "server-only";
import type {
	Paged,
	PrefilterSignals,
	TriageCandidateDto,
	TriageResult,
	TriageStatus,
} from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { ImmichAsset, Prisma } from "@/lib/generated/prisma/client";
import { conflict, notFound } from "@/lib/http/errors";
import { immich } from "@/lib/immich/client";
import type { ImmichBytes } from "@/lib/immich/types";
import { importImmich } from "@/lib/jobs/definitions/import-immich";
import { triageClassify } from "@/lib/jobs/definitions/triage-classify";
import { enqueue } from "@/lib/jobs/queue";
import type { TriageDecisionsInput, TriageQuery } from "./schema";

export function toTriageCandidateDto(asset: ImmichAsset): TriageCandidateDto {
	return {
		id: asset.id,
		immichId: asset.immichId,
		originalFileName: asset.originalFileName,
		mimeType: asset.mimeType,
		width: asset.width,
		height: asset.height,
		fileCreatedAt: asset.fileCreatedAt
			? asset.fileCreatedAt.toISOString()
			: null,
		prefilterScore: asset.prefilterScore,
		prefilterSignals: (asset.prefilterSignals ?? {}) as PrefilterSignals,
		smartHits: asset.smartHits,
		triageStatus: asset.triageStatus as TriageStatus,
		memeProbability: asset.memeProbability,
		triageResult: (asset.triageResult ?? null) as TriageResult | null,
		memeId: asset.memeId,
		error: asset.error,
		previewUrl: `/api/triage/${asset.id}/preview`,
	};
}

export async function listTriageCandidates(
	query: TriageQuery,
): Promise<Paged<TriageCandidateDto>> {
	const where: Prisma.ImmichAssetWhereInput = {
		triageStatus: query.status,
		...(query.minProbability !== undefined
			? { memeProbability: { gte: query.minProbability } }
			: {}),
	};

	const records = await db().immichAsset.findMany({
		where,
		orderBy: [
			{ memeProbability: { sort: "desc", nulls: "last" } },
			{ id: "desc" },
		],
		take: query.limit + 1,
		...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
	});

	let nextCursor: string | null = null;
	let items = records;
	if (records.length > query.limit) {
		items = records.slice(0, query.limit);
		const last = items[items.length - 1];
		if (last) {
			nextCursor = last.id;
		}
	}

	return {
		items: items.map(toTriageCandidateDto),
		nextCursor,
	};
}

const DECIDABLE_STATUSES: readonly TriageStatus[] = [
	"scored",
	"pending",
	"error",
];

type Decision = "accept" | "reject";

/**
 * Atomically moves a decidable asset to accepted/rejected. The status check is
 * part of the UPDATE, so two concurrent decisions can't both win (a late
 * reject can't overwrite an accept whose import is already queued).
 * Returns true only for the caller that made the transition.
 */
async function applyDecision(
	immichAssetId: string,
	decision: Decision,
	actorId: string | null,
	auditExtra: Record<string, unknown> = {},
): Promise<boolean> {
	const target: TriageStatus = decision === "accept" ? "accepted" : "rejected";
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
		select: { memeProbability: true },
	});
	const { count } = await db().immichAsset.updateMany({
		where: { id: immichAssetId, triageStatus: { in: [...DECIDABLE_STATUSES] } },
		data: { triageStatus: target, decidedById: actorId, decidedAt: new Date() },
	});
	if (count === 0) {
		return false;
	}
	if (decision === "accept") {
		await enqueue(importImmich, { immichAssetId });
	}
	await audit({
		actorId,
		action: decision === "accept" ? "triage.accept" : "triage.reject",
		subjectType: "immich_asset",
		subjectId: immichAssetId,
		data: { memeProbability: asset?.memeProbability ?? null, ...auditExtra },
	});
	return true;
}

async function decideOne(
	immichAssetId: string,
	decision: Decision,
	actorId: string | null,
): Promise<{ asset: ImmichAsset; changed: boolean }> {
	const changed = await applyDecision(immichAssetId, decision, actorId);
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
	});
	if (!asset) {
		throw notFound(`Immich asset "${immichAssetId}" not found`);
	}
	const target: TriageStatus = decision === "accept" ? "accepted" : "rejected";
	if (!changed && asset.triageStatus !== target) {
		throw conflict(
			`Cannot ${decision} asset with status "${asset.triageStatus}"`,
		);
	}
	return { asset, changed };
}

export async function acceptAsset(
	immichAssetId: string,
	actorId: string | null,
): Promise<ImmichAsset> {
	return (await decideOne(immichAssetId, "accept", actorId)).asset;
}

export async function rejectAsset(
	immichAssetId: string,
	actorId: string | null,
): Promise<ImmichAsset> {
	return (await decideOne(immichAssetId, "reject", actorId)).asset;
}

export async function decideAssets(
	decisions: TriageDecisionsInput["decisions"],
	actorId: string | null,
): Promise<{ accepted: number; rejected: number }> {
	let accepted = 0;
	let rejected = 0;

	// First decision per asset wins; assets in any other state (including
	// already accepted or rejected) and unknown ids are skipped.
	for (const { immichAssetId, decision } of decisions) {
		if (await applyDecision(immichAssetId, decision, actorId)) {
			if (decision === "accept") accepted++;
			else rejected++;
		}
	}

	return { accepted, rejected };
}

export async function acceptAbove(
	minProbability: number,
	actorId: string | null,
): Promise<{ accepted: number }> {
	const candidates = await db().immichAsset.findMany({
		where: {
			triageStatus: "scored",
			memeProbability: { gte: minProbability },
		},
		select: { id: true },
	});

	let accepted = 0;
	for (const candidate of candidates) {
		// Only count assets this call actually moved (others may have been
		// decided since the query).
		if (
			await applyDecision(candidate.id, "accept", actorId, {
				acceptAbove: minProbability,
			})
		) {
			accepted++;
		}
	}

	return { accepted };
}

export async function resetAsset(
	id: string,
	actorId: string,
): Promise<TriageCandidateDto> {
	const asset = await db().immichAsset.findUnique({ where: { id } });
	if (!asset) {
		throw notFound(`Immich asset "${id}" not found`);
	}

	if (
		asset.triageStatus === "imported" ||
		asset.triageStatus === "deleted" ||
		asset.memeId !== null
	) {
		throw conflict("Asset has already been imported");
	}

	const targetStatus: TriageStatus =
		asset.memeProbability !== null ? "scored" : "pending";

	const updated = await db().immichAsset.update({
		where: { id },
		data: {
			triageStatus: targetStatus,
			decidedById: null,
			decidedAt: null,
			error: null,
		},
	});

	if (targetStatus === "pending") {
		await enqueue(triageClassify, { immichAssetId: id });
	}

	await audit({
		actorId,
		action: "triage.reset",
		subjectType: "immich_asset",
		subjectId: id,
		data: {
			previousStatus: asset.triageStatus,
			targetStatus,
		},
	});

	return toTriageCandidateDto(updated);
}

export async function getThumbnailBytes(
	immichAssetId: string,
): Promise<ImmichBytes> {
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
	});
	if (!asset) {
		throw notFound(`Immich asset "${immichAssetId}" not found`);
	}

	try {
		return await immich().getThumbnail(asset.immichId, "preview");
	} catch (err) {
		if ((err as { status?: number }).status === 404) {
			throw notFound("Asset thumbnail gone in Immich");
		}
		throw err;
	}
}
