import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { aiCall, BudgetExceededError, type ChatMessage } from "@/lib/ai";
import {
	ATTRIBUTION_PLATFORMS,
	type AttributionPlatform,
} from "@/lib/api/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { notFound } from "@/lib/http/errors";
import { PermanentJobError } from "@/lib/jobs/define";
import { getObjectBytes, memeKey } from "@/lib/s3";
import {
	extractClues,
	isReposter,
	KNOWN_REPOSTERS,
	normalizeHandle,
} from "./clues";
import { getReverseImageSearchProvider } from "./reverse-image";

/** True when the host (any subdomain of it) or the first path segment is an aggregator. */
function urlPointsAtReposter(url: URL): boolean {
	const labels = url.hostname.toLowerCase().split(".");
	if (labels.some((label) => isReposter(label))) {
		return true;
	}
	const first = url.pathname.split("/").filter(Boolean)[0];
	return Boolean(first && isReposter(decodeURIComponent(first)));
}

export const attributionCandidateJsonSchema = {
	type: "object",
	properties: {
		candidates: {
			type: "array",
			items: {
				type: "object",
				properties: {
					creatorName: {
						type: ["string", "null"],
						description: "The name of the original creator, or null if unknown",
					},
					handle: {
						type: ["string", "null"],
						description:
							"Social media handle without leading @ or u/, or null if unknown",
					},
					platform: {
						type: "string",
						enum: [
							"instagram",
							"x",
							"reddit",
							"tiktok",
							"tumblr",
							"ninegag",
							"ifunny",
							"web",
							"other",
						],
						description: "Platform where the creator originally published this",
					},
					url: {
						type: ["string", "null"],
						description:
							"Direct HTTPS URL to original post, creator profile or portfolio",
					},
					evidence: {
						type: "string",
						maxLength: 400,
						description:
							"Brief summary (up to 400 chars) of what links this creator to the meme",
					},
					confidence: {
						type: "number",
						minimum: 0,
						maximum: 1,
						description:
							"Confidence from 0 to 1 that this is the original creator",
					},
				},
				required: [
					"creatorName",
					"handle",
					"platform",
					"url",
					"evidence",
					"confidence",
				],
				additionalProperties: false,
			},
		},
	},
	required: ["candidates"],
	additionalProperties: false,
};

export const rawCandidateSchema = z.object({
	creatorName: z.string().nullable(),
	handle: z.string().nullable(),
	platform: z.enum(ATTRIBUTION_PLATFORMS),
	url: z.string().nullable(),
	evidence: z.string(),
	confidence: z.number().min(0).max(1),
});

export const rawAttributionResponseSchema = z.object({
	candidates: z.array(rawCandidateSchema),
});

export type PostProcessedCandidate = {
	creatorName: string | null;
	handle: string | null;
	platform: AttributionPlatform;
	url: string | null;
	evidence: string;
	confidence: number;
	rank: number;
};

/**
 * Filters, caps confidence, and re-ranks raw candidates:
 * - Drops candidate if handle is a known reposter
 * - Drops candidate if url is present but not https
 * - Caps confidence at 0.5 when there is no url
 * - Sorts by confidence desc and assigns rank 1..5
 */
export function postProcessCandidates(
	rawCandidates: z.infer<typeof rawCandidateSchema>[],
): PostProcessedCandidate[] {
	const valid: Array<Omit<PostProcessedCandidate, "rank">> = [];

	for (const candidate of rawCandidates) {
		const cleanHandle = candidate.handle
			? normalizeHandle(candidate.handle)
			: null;

		// Drop candidate whose handle or credited name is a known reposter
		if (cleanHandle && isReposter(cleanHandle)) {
			continue;
		}
		const cleanName = candidate.creatorName?.trim() || null;
		if (cleanName && isReposter(cleanName)) {
			continue;
		}

		const url = candidate.url?.trim() || null;
		if (url) {
			// Drop candidates whose url is not https
			if (!url.startsWith("https://")) {
				continue;
			}
			try {
				const parsed = new URL(url);
				if (urlPointsAtReposter(parsed)) {
					continue;
				}
			} catch {
				continue;
			}
		}

		// Nothing to credit or follow up: not a candidate
		if (!cleanName && !cleanHandle && !url) {
			continue;
		}

		// Cap confidence at 0.5 when there is no url
		let confidence = candidate.confidence;
		if (!url) {
			confidence = Math.min(confidence, 0.5);
		}

		const evidence = (candidate.evidence || "").slice(0, 400);

		valid.push({
			creatorName: cleanName,
			handle: cleanHandle || null,
			platform: candidate.platform,
			url,
			evidence,
			confidence,
		});
	}

	// Re-rank by confidence descending
	valid.sort((a, b) => b.confidence - a.confidence);

	// Take up to 5
	return valid.slice(0, 5).map((c, index) => ({
		...c,
		rank: index + 1,
	}));
}

/**
 * Searches for attribution for a meme using OpenRouter web-search vision model.
 */
export async function runAttribution(
	memeId: string,
	analysisId?: string,
): Promise<void> {
	// 1. Fetch or create the Analysis row
	let analysis = analysisId
		? await db().analysis.findUnique({ where: { id: analysisId } })
		: await db().analysis.findFirst({
				where: {
					memeId,
					kind: "attribution",
					status: { in: ["queued", "running"] },
				},
				orderBy: { createdAt: "desc" },
			});

	if (!analysis) {
		analysis = await db().analysis.create({
			data: {
				memeId,
				kind: "attribution",
				status: "running",
				model: env().OPENROUTER_ATTRIBUTION_MODEL,
			},
		});
	} else if (analysis.status !== "running") {
		analysis = await db().analysis.update({
			where: { id: analysis.id },
			data: {
				status: "running",
				model: env().OPENROUTER_ATTRIBUTION_MODEL,
			},
		});
	}

	try {
		// 2. Fetch the meme
		const meme = await db().meme.findUnique({
			where: { id: memeId },
			include: {
				analyses: {
					where: { kind: "meme", status: "done" },
					orderBy: { createdAt: "desc" },
					take: 1,
				},
				immichAsset: {
					select: { originalFileName: true },
				},
			},
		});

		if (!meme) {
			throw notFound("Meme not found");
		}

		// 3. Extract clues
		const lastMemeAnalysis = meme.analyses[0]?.result as
			| {
					attributionClues?: {
						watermarks?: string[];
						handles?: string[];
						sites?: string[];
						subreddits?: string[];
					};
			  }
			| undefined;

		const clues = extractClues({
			ocrText: meme.ocrText,
			analysisClues: lastMemeAnalysis?.attributionClues,
			originalFileName: meme.immichAsset?.originalFileName,
		});

		// 4. Reverse image search matches
		let displayBytes: Uint8Array | null = null;
		try {
			displayBytes = await getObjectBytes(memeKey(meme.id, "display"));
		} catch {
			try {
				displayBytes = await getObjectBytes(
					memeKey(meme.id, "original", meme.contentType),
				);
			} catch {
				displayBytes = null;
			}
		}

		const reverseMatches = displayBytes
			? await getReverseImageSearchProvider().search(displayBytes)
			: [];

		// 5. Convert display image to JPEG data URL
		let dataUrl: string | null = null;
		if (displayBytes) {
			try {
				const jpegBuffer = await sharp(displayBytes).jpeg().toBuffer();
				dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
			} catch {
				dataUrl = null;
			}
		}

		// 6. Build prompt
		const promptLines: string[] = [
			"You are an expert meme researcher and attribution specialist. Your task is to identify the ORIGINAL creator, author, artist, or earliest origin of this meme.",
			"IMPORTANT RULES:",
			"1. Find the ORIGINAL creator, NOT aggregator accounts, meme reposters, or meme compilation sites.",
			`2. The following accounts/sites are known aggregators/reposters and MUST NOT be credited as creators: ${KNOWN_REPOSTERS.join(", ")}.`,
			"3. If you cannot identify the original creator with reasonable evidence and confidence, return an empty list of candidates rather than guessing.",
			"4. For each candidate, provide the creator's name, handle (without @ or u/), platform, direct https URL, evidence linking them to the meme (<= 400 characters), and confidence (0.0 to 1.0).",
			"5. Return up to 5 candidates ranked by confidence.",
		];

		if (meme.ocrText) {
			promptLines.push(`OCR text extracted from image:\n"""${meme.ocrText}"""`);
		}
		if (clues.handles.length > 0) {
			promptLines.push(`Extracted handles: ${clues.handles.join(", ")}`);
		}
		if (clues.subreddits.length > 0) {
			promptLines.push(`Extracted subreddits: ${clues.subreddits.join(", ")}`);
		}
		if (clues.sites.length > 0) {
			promptLines.push(`Extracted sites: ${clues.sites.join(", ")}`);
		}
		if (clues.watermarks.length > 0) {
			promptLines.push(`Extracted watermarks: ${clues.watermarks.join(", ")}`);
		}
		if (reverseMatches.length > 0) {
			promptLines.push(
				`Reverse image search matches:\n${reverseMatches
					.map((m) => `- ${m.url}${m.title ? ` (${m.title})` : ""}`)
					.join("\n")}`,
			);
		}

		const userMessageContent = dataUrl
			? [
					{ type: "text" as const, text: promptLines.join("\n\n") },
					{ type: "image_url" as const, image_url: { url: dataUrl } },
				]
			: promptLines.join("\n\n");

		const messages: ChatMessage[] = [
			{
				role: "system",
				content:
					"You are an investigator looking for the original creator of memes. Always output strict JSON matching the schema.",
			},
			{
				role: "user",
				content: userMessageContent,
			},
		];

		// 7. Call OpenRouter with web search plugin
		const response = await aiCall({
			kind: "attribution",
			model: env().OPENROUTER_ATTRIBUTION_MODEL,
			plugins: [{ id: "web", max_results: 5 }],
			refId: meme.id,
			schemaName: "attribution_candidates",
			schema: attributionCandidateJsonSchema,
			messages,
		});

		// 8. Parse and post-process
		let parsed: z.infer<typeof rawAttributionResponseSchema>;
		try {
			const json = JSON.parse(response.content);
			parsed = rawAttributionResponseSchema.parse(json);
		} catch (parseErr) {
			throw new PermanentJobError(
				`Invalid JSON from attribution model: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
			);
		}

		const candidates = postProcessCandidates(parsed.candidates);

		// 9. Store candidates and update analysis in transaction
		await db().$transaction(async (tx) => {
			// Delete earlier unconfirmed, unrejected candidates; confirmed and
			// rejected ones are decisions the user made and stay.
			await tx.attributionCandidate.deleteMany({
				where: {
					memeId: meme.id,
					confirmedAt: null,
					rejectedAt: null,
				},
			});

			const kept = await tx.attributionCandidate.findMany({
				where: { memeId: meme.id },
				select: { id: true, handle: true, platform: true, url: true },
				orderBy: { rank: "asc" },
			});
			const sameAsKept = (c: PostProcessedCandidate) =>
				kept.some(
					(k) =>
						(c.url && k.url && c.url === k.url) ||
						(c.handle &&
							k.handle &&
							c.platform === k.platform &&
							c.handle.toLowerCase() === k.handle.toLowerCase()),
				);
			// A creator the user already confirmed or rejected is not offered again.
			const fresh = candidates
				.filter((c) => !sameAsKept(c))
				.map((c, i) => ({ ...c, rank: i + 1 }));
			// Decided candidates sort after the fresh ones, in their old order.
			for (const [i, k] of kept.entries()) {
				await tx.attributionCandidate.update({
					where: { id: k.id },
					data: { rank: fresh.length + i + 1 },
				});
			}

			if (fresh.length > 0) {
				await tx.attributionCandidate.createMany({
					data: fresh.map((c) => ({
						memeId: meme.id,
						analysisId: analysis.id,
						creatorName: c.creatorName,
						handle: c.handle,
						platform: c.platform,
						url: c.url,
						evidence: c.evidence,
						confidence: c.confidence,
						rank: c.rank,
					})),
				});
			}

			await tx.analysis.update({
				where: { id: analysis.id },
				data: {
					status: "done",
					model: response.model,
					costUsd: response.usage?.cost ?? 0,
					result: {
						candidates: fresh,
						citations: response.citations ?? [],
					},
				},
			});
		});
	} catch (err) {
		if (err instanceof BudgetExceededError) {
			// Keep analysis in queued/running or record deferral, rethrow for pg-boss re-enqueue
			throw err;
		}

		await db()
			.analysis.update({
				where: { id: analysis.id },
				data: {
					status: "failed",
					error: err instanceof Error ? err.message : String(err),
				},
			})
			.catch(() => {});

		if (err instanceof PermanentJobError) {
			throw err;
		}
		throw new PermanentJobError(
			err instanceof Error ? err.message : String(err),
		);
	}
}
