import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { enqueue, stopBoss } from "@/lib/jobs/queue";
import { startWorker } from "@/lib/jobs/worker";
import { memeKey } from "@/lib/s3";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

describeWithDb("analysis.meme job via worker", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		process.env.OPENROUTER_API_KEY = "sk-test-key";
		resetEnvCache();
	});

	afterEach(() => {
		fakeS3.restore();
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await stopBoss();
	});

	it("processes an enqueued analysis.meme job to completion", async () => {
		const meme = await createMeme({ renditionsReady: true });
		const webpBuffer = await sharp({
			create: {
				width: 10,
				height: 10,
				channels: 4,
				background: { r: 120, g: 120, b: 120, alpha: 1 },
			},
		})
			.webp()
			.toBuffer();
		fakeS3.upload(memeKey(meme.id, "display"), new Uint8Array(webpBuffer));

		const mockAiOutput = {
			ocrText: "Worker test meme",
			description: "A meme tested through the background worker",
			altText: "Test meme",
			template: "Worker Template",
			language: "en",
			era: "2026",
			topics: ["worker", "testing"],
			styles: ["automation"],
			sensitivity: {
				nsfw: false,
				politics: false,
				slurs: false,
				personalData: false,
				notes: null,
			},
			quality: {
				lowRes: false,
				heavyCompression: false,
				cropped: false,
				watermark: false,
			},
			postability: 88,
			captionDraft: "Background jobs running smoothly",
			hashtags: ["worker", "automation"],
			attributionClues: {
				watermarks: [],
				handles: [],
				sites: [],
				subreddits: [],
			},
		};

		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					model: "google/gemini-3.1-flash-lite",
					choices: [
						{
							message: {
								content: JSON.stringify(mockAiOutput),
							},
						},
					],
					usage: { prompt_tokens: 150, completion_tokens: 40, cost: 0.002 },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const analysis = await db().analysis.create({
			data: {
				memeId: meme.id,
				kind: "meme",
				status: "queued",
			},
		});

		await startWorker();
		await enqueue(analysisMeme, { memeId: meme.id, analysisId: analysis.id });

		await vi.waitFor(
			async () => {
				const updated = await db().analysis.findUnique({
					where: { id: analysis.id },
				});
				expect(updated?.status).toBe("done");
				expect(updated?.costUsd).toBe(0.002);
			},
			{ timeout: 15_000, interval: 250 },
		);

		const updatedMeme = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});
		expect(updatedMeme.ocrText).toBe("Worker test meme");
		expect(updatedMeme.template).toBe("Worker Template");
	}, 20_000);
});
