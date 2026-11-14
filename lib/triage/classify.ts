import "server-only";
import {
	aiCall,
	BudgetExceededError,
	type ChatMessage,
	nextBudgetReset,
} from "@/lib/ai";
import type { TriageResult } from "@/lib/api/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import { immich } from "@/lib/immich/client";
import type { ImmichBytes } from "@/lib/immich/types";
import { triageClassify } from "@/lib/jobs/definitions/triage-classify";
import { enqueue } from "@/lib/jobs/queue";
import { getSetting } from "@/lib/settings";
import { triageResultSchema } from "./schema";
import { acceptAsset } from "./service";

const TRIAGE_JSON_SCHEMA = {
	type: "object",
	properties: {
		memeProbability: {
			type: "number",
			description:
				"Estimated probability between 0.0 and 1.0 that this image is a meme, reaction image, comic, or humorous social screenshot.",
		},
		kind: {
			type: "string",
			enum: [
				"meme",
				"reaction_image",
				"comic",
				"social_screenshot",
				"chat_screenshot",
				"other_screenshot",
				"photo",
				"document",
				"other",
			],
			description: "Classification kind of the image",
		},
		reason: {
			type: "string",
			description: "Brief reason explaining the classification",
		},
	},
	required: ["memeProbability", "kind", "reason"],
	additionalProperties: false,
};

const TRIAGE_SYSTEM_PROMPT =
	"You are an image triage classifier for a meme archive.\n" +
	"Classify the image into one of:\n" +
	"- meme: Image macros, captioned humorous images, internet memes\n" +
	"- reaction_image: Images used to express a reaction/emotion online\n" +
	"- comic: Webcomics, comic strips, cartoon panels\n" +
	"- social_screenshot: Screenshots of social media posts (X/Twitter, Reddit, etc.) shared as humor or commentary\n" +
	"- chat_screenshot: Ordinary personal or work chat messages (WhatsApp, iMessage, Slack)\n" +
	"- other_screenshot: Screenshots of articles, apps, receipts, code, settings\n" +
	"- photo: Ordinary personal or stock photographs\n" +
	"- document: Documents, slides, PDFs, forms\n" +
	"- other: Anything else\n\n" +
	"Distinguish memes/reaction images/comics/social screenshots (high memeProbability) from ordinary chat screenshots, other screenshots, photos, and documents (low memeProbability).\n" +
	"Return a strict JSON object with memeProbability (0.0 to 1.0), kind, and reason.";

export type RunTriageOptions = {
	retryCount?: number;
	retryLimit?: number;
	isLastAttempt?: boolean;
};

async function handleGeneralError(
	immichAssetId: string,
	err: unknown,
	options?: RunTriageOptions,
): Promise<void> {
	const isLastAttempt =
		options?.isLastAttempt === true ||
		(options?.retryCount !== undefined &&
			options?.retryLimit !== undefined &&
			options.retryCount >= options.retryLimit);

	if (isLastAttempt) {
		const message = err instanceof Error ? err.message : String(err);
		await db().immichAsset.update({
			where: { id: immichAssetId },
			data: {
				triageStatus: "error",
				error: message,
			},
		});
	}
}

export async function runTriage(
	immichAssetId: string,
	options?: RunTriageOptions,
): Promise<void> {
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
	});
	if (!asset) {
		throw new Error(`ImmichAsset "${immichAssetId}" not found`);
	}

	if (
		asset.triageStatus === "accepted" ||
		asset.triageStatus === "rejected" ||
		asset.triageStatus === "imported" ||
		asset.triageStatus === "deleted"
	) {
		return;
	}

	let thumbnail: ImmichBytes;
	try {
		thumbnail = await immich().getThumbnail(asset.immichId, "preview");
	} catch (err) {
		if ((err as { status?: number }).status === 404) {
			await db().immichAsset.update({
				where: { id: immichAssetId },
				data: {
					triageStatus: "error",
					error: "gone",
				},
			});
			return;
		}
		await handleGeneralError(immichAssetId, err, options);
		throw err;
	}

	const messages: ChatMessage[] = [
		{ role: "system", content: TRIAGE_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				{ type: "text", text: "Classify this image." },
				{
					type: "image_url",
					image_url: {
						url: `data:${thumbnail.contentType};base64,${Buffer.from(thumbnail.bytes).toString("base64")}`,
					},
				},
			],
		},
	];

	let response: Awaited<ReturnType<typeof aiCall>>;
	try {
		response = await aiCall({
			kind: "triage",
			model: env().OPENROUTER_TRIAGE_MODEL,
			refId: asset.id,
			schemaName: "triage_classification",
			schema: TRIAGE_JSON_SCHEMA,
			messages,
			maxTokens: 250,
		});
	} catch (err) {
		if (err instanceof BudgetExceededError) {
			await db().immichAsset.update({
				where: { id: immichAssetId },
				data: {
					triageStatus: "pending",
				},
			});
			await enqueue(
				triageClassify,
				{ immichAssetId },
				{ startAfter: nextBudgetReset() },
			);
			return;
		}
		await handleGeneralError(immichAssetId, err, options);
		throw err;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content);
	} catch {
		const parseError = new Error(
			`Failed to parse triage JSON completion: ${response.content}`,
		);
		await handleGeneralError(immichAssetId, parseError, options);
		throw parseError;
	}

	const validated = triageResultSchema.parse(parsed);
	const probability = Math.max(0, Math.min(1, validated.memeProbability));
	const triageResult: TriageResult = {
		...validated,
		memeProbability: probability,
	};

	await db().immichAsset.update({
		where: { id: immichAssetId },
		data: {
			memeProbability: probability,
			triageModel: response.model,
			triageResult: triageResult as unknown as Prisma.InputJsonValue,
			triageStatus: "scored",
			error: null,
		},
	});

	await db().analysis.create({
		data: {
			memeId: null,
			kind: "triage",
			model: response.model,
			status: "done",
			result: triageResult as unknown as Prisma.InputJsonValue,
			costUsd: response.usage?.cost ?? 0,
		},
	});

	const autoAcceptThreshold = await getSetting("triage.autoAcceptThreshold");
	if (autoAcceptThreshold !== null && probability >= autoAcceptThreshold) {
		await acceptAsset(asset.id, null);
	}
}
