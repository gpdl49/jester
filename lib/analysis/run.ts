import sharp from "sharp";
import {
	aiCall,
	BudgetExceededError,
	nextBudgetReset,
	OpenRouterError,
} from "@/lib/ai";
import type { AnalysisDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Analysis } from "@/lib/generated/prisma/client";
import { PermanentJobError } from "@/lib/jobs/define";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { enqueue } from "@/lib/jobs/queue";
import { getObjectBytes, memeKey } from "@/lib/s3";
import { applyAnalysis } from "./apply";
import { presentAnalysis } from "./present";
import { ANALYSIS_SYSTEM_PROMPT } from "./prompt";
import { MEME_ANALYSIS_JSON_SCHEMA } from "./schema";

/**
 * Runs meme vision analysis:
 * - Requires renditionsReady. If not ready, re-enqueues with startAfter: 60 up to 10 times.
 * - Loads display.webp from S3, converts to JPEG, base64 encodes it.
 * - Calls aiCall() with strict JSON schema and careful prompt.
 * - Applies fields to Meme (respecting userEdited) and upserts tags.
 * - Handles BudgetExceededError (re-enqueues at nextBudgetReset()) and OpenRouter/schema errors.
 */
export async function runMemeAnalysis(
	memeId: string,
	analysisId?: string,
): Promise<AnalysisDto> {
	let analysis: Analysis;
	if (analysisId) {
		const existing = await db().analysis.findUnique({
			where: { id: analysisId },
		});
		if (!existing) {
			throw new PermanentJobError(`Analysis not found: ${analysisId}`);
		}
		// A duplicate or retried delivery for a finished analysis must not pay
		// for (or apply) a second model call.
		if (existing.status === "done") {
			return presentAnalysis(existing);
		}
		analysis = existing;
	} else {
		const existing = await db().analysis.findFirst({
			where: {
				memeId,
				kind: "meme",
				status: { in: ["queued", "running"] },
			},
			orderBy: { createdAt: "desc" },
		});
		if (existing) {
			analysis = existing;
		} else {
			analysis = await db().analysis.create({
				data: {
					memeId,
					kind: "meme",
					status: "running",
					model: env().OPENROUTER_ANALYSIS_MODEL,
				},
			});
		}
	}

	const meme = await db().meme.findUnique({
		where: { id: memeId },
	});
	if (!meme) {
		await db().analysis.update({
			where: { id: analysis.id },
			data: { status: "failed", error: `Meme not found: ${memeId}` },
		});
		throw new PermanentJobError(`Meme not found: ${memeId}`);
	}

	// 1. Verify renditionsReady
	if (!meme.renditionsReady) {
		const resultObj =
			analysis.result && typeof analysis.result === "object"
				? (analysis.result as Record<string, unknown>)
				: {};
		const currentAttempts =
			typeof resultObj.attempts === "number" ? resultObj.attempts : 0;

		if (currentAttempts >= 10) {
			await db().analysis.update({
				where: { id: analysis.id },
				data: {
					status: "failed",
					error: "Renditions not ready after 10 attempts",
				},
			});
			throw new PermanentJobError("Renditions not ready after 10 attempts");
		}

		const nextAttempts = currentAttempts + 1;
		const queuedAnalysis = await db().analysis.update({
			where: { id: analysis.id },
			data: {
				status: "queued",
				result: { ...resultObj, attempts: nextAttempts },
			},
		});

		await enqueue(
			analysisMeme,
			{ memeId, analysisId: analysis.id },
			{ startAfter: 60 },
		);

		return presentAnalysis(queuedAnalysis);
	}

	// 2. Mark analysis as running
	analysis = await db().analysis.update({
		where: { id: analysis.id },
		data: {
			status: "running",
			model: env().OPENROUTER_ANALYSIS_MODEL,
			error: null,
		},
	});

	// 3. Load display.webp from S3 and re-encode as JPEG
	const key = memeKey(memeId, "display");
	let webpBytes: Uint8Array;
	try {
		webpBytes = await getObjectBytes(key);
	} catch (err) {
		const message = `Failed to get display rendition from S3: ${err instanceof Error ? err.message : String(err)}`;
		await db().analysis.update({
			where: { id: analysis.id },
			data: { status: "failed", error: message },
		});
		throw new PermanentJobError(message);
	}

	let jpegBuffer: Buffer;
	try {
		jpegBuffer = await sharp(Buffer.from(webpBytes)).jpeg().toBuffer();
	} catch (err) {
		const message = `Failed to encode display rendition as JPEG: ${err instanceof Error ? err.message : String(err)}`;
		await db().analysis.update({
			where: { id: analysis.id },
			data: { status: "failed", error: message },
		});
		throw new PermanentJobError(message);
	}

	const base64DataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;

	// 4. Call AI model
	let response: Awaited<ReturnType<typeof aiCall>>;
	try {
		response = await aiCall({
			kind: "meme",
			model: env().OPENROUTER_ANALYSIS_MODEL,
			messages: [
				{ role: "system", content: ANALYSIS_SYSTEM_PROMPT },
				{
					role: "user",
					content: [
						{ type: "text", text: "Analyze this meme." },
						{ type: "image_url", image_url: { url: base64DataUrl } },
					],
				},
			],
			schemaName: "meme_analysis",
			schema: MEME_ANALYSIS_JSON_SCHEMA,
			refId: memeId,
			maxTokens: 2000,
		});
	} catch (err) {
		if (err instanceof BudgetExceededError) {
			const queued = await db().analysis.update({
				where: { id: analysis.id },
				data: { status: "queued" },
			});
			await enqueue(
				analysisMeme,
				{ memeId, analysisId: analysis.id },
				{ startAfter: nextBudgetReset() },
			);
			return presentAnalysis(queued);
		}
		if (err instanceof OpenRouterError) {
			await db().analysis.update({
				where: { id: analysis.id },
				data: {
					status: "failed",
					error: err.message,
				},
			});
			throw new PermanentJobError(err.message);
		}
		await db().analysis.update({
			where: { id: analysis.id },
			data: {
				status: "failed",
				error: err instanceof Error ? err.message : String(err),
			},
		});
		throw err;
	}

	// 5. Parse and apply analysis
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content);
	} catch {
		const message = "Invalid JSON returned by OpenRouter";
		await db().analysis.update({
			where: { id: analysis.id },
			data: {
				status: "failed",
				error: message,
				costUsd: response.usage?.cost ?? null,
			},
		});
		throw new PermanentJobError(message);
	}

	try {
		const updated = await applyAnalysis(
			memeId,
			analysis.id,
			parsed,
			response.usage?.cost ?? null,
			response.model,
		);
		return presentAnalysis(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db().analysis.update({
			where: { id: analysis.id },
			data: {
				status: "failed",
				error: message,
				costUsd: response.usage?.cost ?? null,
			},
		});
		throw new PermanentJobError(message);
	}
}
