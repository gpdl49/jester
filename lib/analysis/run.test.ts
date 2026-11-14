import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { PermanentJobError } from "@/lib/jobs/define";
import * as queueModule from "@/lib/jobs/queue";
import { memeKey } from "@/lib/s3";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { runMemeAnalysis } from "./run";

describeWithDb("runMemeAnalysis", () => {
	let fakeS3: FakeS3;
	let enqueueSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		enqueueSpy = vi.spyOn(queueModule, "enqueue").mockResolvedValue("job-123");
		process.env.OPENROUTER_API_KEY = "sk-test-key";
		resetEnvCache();
	});

	afterEach(() => {
		fakeS3.restore();
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();
		vi.restoreAllMocks();
	});

	it("re-enqueues with startAfter 60s when renditionsReady is false", async () => {
		const meme = await createMeme({ renditionsReady: false });

		const result = await runMemeAnalysis(meme.id);

		expect(result.status).toBe("queued");
		expect((result.result as { attempts?: number })?.attempts).toBe(1);

		expect(enqueueSpy).toHaveBeenCalledOnce();
		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ name: "analysis.meme" }),
			{ memeId: meme.id, analysisId: result.id },
			{ startAfter: 60 },
		);
	});

	it("fails permanently when renditions-not-ready reaches 10 attempts", async () => {
		const meme = await createMeme({ renditionsReady: false });
		const analysis = await db().analysis.create({
			data: {
				memeId: meme.id,
				kind: "meme",
				status: "queued",
				result: { attempts: 10 },
			},
		});

		await expect(runMemeAnalysis(meme.id, analysis.id)).rejects.toThrow(
			PermanentJobError,
		);

		const updated = await db().analysis.findUniqueOrThrow({
			where: { id: analysis.id },
		});
		expect(updated.status).toBe("failed");
		expect(updated.error).toContain("10 attempts");
	});

	it("loads display.webp from S3, re-encodes, calls vision model, and applies analysis", async () => {
		const meme = await createMeme({ renditionsReady: true });

		// Put a real 10x10 WebP into fake S3 at memeKey(meme.id, "display")
		const webpBuffer = await sharp({
			create: {
				width: 10,
				height: 10,
				channels: 4,
				background: { r: 255, g: 0, b: 0, alpha: 1 },
			},
		})
			.webp()
			.toBuffer();

		fakeS3.upload(memeKey(meme.id, "display"), new Uint8Array(webpBuffer));

		const mockAiOutput = {
			ocrText: "Success Kid\nNailed it",
			description: "Baby on a beach making a fist with determination",
			altText: "Baby on beach making a fist celebrating",
			template: "Success Kid",
			language: "en",
			era: "2007",
			topics: ["success", "motivation"],
			styles: ["classic"],
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
			postability: 92,
			captionDraft: "When the unit tests pass on first try",
			hashtags: ["success", "coding"],
			attributionClues: {
				watermarks: [],
				handles: [],
				sites: [],
				subreddits: [],
			},
		};

		// Mock OpenRouter fetch
		const fetchMock = vi.fn(async (_url: string | URL | Request) => {
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
					usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0015 },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runMemeAnalysis(meme.id);

		expect(result.status).toBe("done");
		expect(result.costUsd).toBe(0.0015);
		expect(result.model).toBe("google/gemini-3.1-flash-lite");

		// Verify Meme updated
		const updatedMeme = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});
		expect(updatedMeme.ocrText).toBe("Success Kid\nNailed it");
		expect(updatedMeme.template).toBe("Success Kid");
		expect(updatedMeme.postability).toBe(92);
		expect(updatedMeme.era).toBe("2007");

		// Verify AI usage recorded
		const usage = await db().aiUsage.findFirst({
			where: { refId: meme.id },
		});
		expect(usage).toBeDefined();
		expect(usage?.kind).toBe("meme");
		expect(usage?.costUsd).toBe(0.0015);
	});

	it("re-enqueues at nextBudgetReset when daily budget is exceeded", async () => {
		const meme = await createMeme({ renditionsReady: true });
		const webpBuffer = await sharp({
			create: {
				width: 10,
				height: 10,
				channels: 4,
				background: { r: 0, g: 255, b: 0, alpha: 1 },
			},
		})
			.webp()
			.toBuffer();
		fakeS3.upload(memeKey(meme.id, "display"), new Uint8Array(webpBuffer));

		// Set setting ai.dailyBudgetUsd to 1, and insert usage of $2 today
		await db().setting.upsert({
			where: { key: "ai.dailyBudgetUsd" },
			create: { key: "ai.dailyBudgetUsd", value: 1 },
			update: { value: 1 },
		});
		await db().aiUsage.create({
			data: {
				kind: "meme",
				model: "mock",
				costUsd: 2.0,
				at: new Date(),
			},
		});

		const result = await runMemeAnalysis(meme.id);

		expect(result.status).toBe("queued");
		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ name: "analysis.meme" }),
			{ memeId: meme.id, analysisId: result.id },
			expect.objectContaining({
				startAfter: expect.any(Date),
			}),
		);
	});

	it("marks analysis as failed and throws PermanentJobError on OpenRouter error", async () => {
		const meme = await createMeme({ renditionsReady: true });
		const webpBuffer = await sharp({
			create: {
				width: 10,
				height: 10,
				channels: 4,
				background: { r: 0, g: 0, b: 255, alpha: 1 },
			},
		})
			.webp()
			.toBuffer();
		fakeS3.upload(memeKey(meme.id, "display"), new Uint8Array(webpBuffer));

		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					error: { message: "Invalid API key provided" },
				}),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(runMemeAnalysis(meme.id)).rejects.toThrow(PermanentJobError);

		const analysis = await db().analysis.findFirstOrThrow({
			where: { memeId: meme.id },
		});
		expect(analysis.status).toBe("failed");
		expect(analysis.error).toContain(
			"OpenRouter 401: Invalid API key provided",
		);
	});
});
