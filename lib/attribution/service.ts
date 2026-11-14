import "server-only";
import type { MemeDetailDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { getMemeDetail } from "./detail";
import { formatCreditText } from "./format";

/**
 * Confirms an attribution candidate for a meme:
 * - Stamps confirmedById and confirmedAt on the candidate
 * - Sets meme.attributionId and meme.creditText (@handle on Platform...)
 * - Replaces earlier confirmed candidate if one existed
 * - Records an audit event
 * - Returns updated MemeDetailDto
 */
export async function confirmAttribution(
	memeId: string,
	candidateId: string,
	actorId: string | null,
): Promise<MemeDetailDto> {
	const meme = await db().meme.findUnique({
		where: { id: memeId },
		select: { id: true, attributionId: true },
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	const candidate = await db().attributionCandidate.findUnique({
		where: { id: candidateId },
	});

	if (!candidate || candidate.memeId !== meme.id) {
		throw notFound("Attribution candidate not found");
	}

	const creditText = formatCreditText(candidate);
	const now = new Date();

	await db().$transaction(async (tx) => {
		// If another candidate was confirmed, unconfirm it
		if (meme.attributionId && meme.attributionId !== candidate.id) {
			await tx.attributionCandidate.update({
				where: { id: meme.attributionId },
				data: {
					confirmedById: null,
					confirmedAt: null,
				},
			});
		}

		// Update candidate
		await tx.attributionCandidate.update({
			where: { id: candidate.id },
			data: {
				confirmedById: actorId,
				confirmedAt: now,
				rejectedAt: null,
			},
		});

		// Update meme
		await tx.meme.update({
			where: { id: meme.id },
			data: {
				attributionId: candidate.id,
				creditText,
			},
		});

		// Audit
		await audit(
			{
				actorId,
				action: "attribution.confirm",
				subjectType: "meme",
				subjectId: meme.id,
				data: {
					candidateId: candidate.id,
					creditText,
					platform: candidate.platform,
					handle: candidate.handle,
					creatorName: candidate.creatorName,
				},
			},
			tx,
		);
	});

	return getMemeDetail(meme.id);
}

/**
 * Rejects an attribution candidate for a meme:
 * - Stamps rejectedAt on the candidate
 * - If this candidate was confirmed on the meme, clears meme.attributionId and meme.creditText
 * - Records an audit event
 * - Returns updated MemeDetailDto
 */
export async function rejectAttribution(
	memeId: string,
	candidateId: string,
	actorId: string | null,
): Promise<MemeDetailDto> {
	const meme = await db().meme.findUnique({
		where: { id: memeId },
		select: { id: true, attributionId: true },
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	const candidate = await db().attributionCandidate.findUnique({
		where: { id: candidateId },
	});

	if (!candidate || candidate.memeId !== meme.id) {
		throw notFound("Attribution candidate not found");
	}

	const now = new Date();

	await db().$transaction(async (tx) => {
		await tx.attributionCandidate.update({
			where: { id: candidate.id },
			data: {
				rejectedAt: now,
				confirmedById: null,
				confirmedAt: null,
			},
		});

		// If this was the confirmed attribution, clear it
		if (meme.attributionId === candidate.id) {
			await tx.meme.update({
				where: { id: meme.id },
				data: {
					attributionId: null,
					creditText: null,
				},
			});
		}

		await audit(
			{
				actorId,
				action: "attribution.reject",
				subjectType: "meme",
				subjectId: meme.id,
				data: {
					candidateId: candidate.id,
					clearedActiveAttribution: meme.attributionId === candidate.id,
				},
			},
			tx,
		);
	});

	return getMemeDetail(meme.id);
}
