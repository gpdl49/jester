import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postProcessCandidates, runAttribution } from "@/lib/attribution/find";
import { setReverseImageSearchProvider } from "@/lib/attribution/reverse-image";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { memeKey } from "@/lib/s3";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { installFakeS3 } from "@/test/helpers/s3";

describe("postProcessCandidates unit logic", () => {
	it("drops candidates whose handle is a known reposter", () => {
		const result = postProcessCandidates([
			{
				creatorName: "9GAG Team",
				handle: "9gag",
				platform: "ninegag",
				url: "https://9gag.com/gag/123",
				evidence: "Posted on 9gag",
				confidence: 0.9,
			},
			{
				creatorName: "Valid Artist",
				handle: "valid_artist",
				platform: "instagram",
				url: "https://instagram.com/valid_artist",
				evidence: "Original artist",
				confidence: 0.85,
			},
			{
				creatorName: "Pubity",
				handle: "@pubity",
				platform: "instagram",
				url: "https://instagram.com/pubity",
				evidence: "Meme page",
				confidence: 0.8,
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0]?.handle).toBe("valid_artist");
		expect(result[0]?.rank).toBe(1);
	});

	it("drops candidates whose url is not https", () => {
		const result = postProcessCandidates([
			{
				creatorName: "HTTP site",
				handle: "http_user",
				platform: "web",
				url: "http://example.com/art",
				evidence: "Insecure site",
				confidence: 0.7,
			},
			{
				creatorName: "HTTPS site",
				handle: "https_user",
				platform: "web",
				url: "https://example.com/art",
				evidence: "Secure site",
				confidence: 0.7,
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0]?.handle).toBe("https_user");
	});

	it("caps confidence at 0.5 when there is no url", () => {
		const result = postProcessCandidates([
			{
				creatorName: "High Confidence But No URL",
				handle: "mystery_user",
				platform: "x",
				url: null,
				evidence: "Signature seen in corner",
				confidence: 0.95,
			},
			{
				creatorName: "With URL",
				handle: "known_user",
				platform: "x",
				url: "https://x.com/known_user/status/1",
				evidence: "Posted with art assets",
				confidence: 0.7,
			},
		]);

		// mystery_user confidence should be capped at 0.5, so known_user (0.7) ranks #1
		expect(result[0]?.handle).toBe("known_user");
		expect(result[0]?.rank).toBe(1);
		expect(result[1]?.handle).toBe("mystery_user");
		expect(result[1]?.confidence).toBe(0.5);
		expect(result[1]?.rank).toBe(2);
	});

	it("re-ranks candidates by confidence and limits to top 5", () => {
		const input = [
			{
				creatorName: "C1",
				handle: "c1",
				platform: "web" as const,
				url: "https://example.com/1",
				evidence: "ev",
				confidence: 0.2,
			},
			{
				creatorName: "C2",
				handle: "c2",
				platform: "web" as const,
				url: "https://example.com/2",
				evidence: "ev",
				confidence: 0.9,
			},
			{
				creatorName: "C3",
				handle: "c3",
				platform: "web" as const,
				url: "https://example.com/3",
				evidence: "ev",
				confidence: 0.6,
			},
			{
				creatorName: "C4",
				handle: "c4",
				platform: "web" as const,
				url: "https://example.com/4",
				evidence: "ev",
				confidence: 0.8,
			},
			{
				creatorName: "C5",
				handle: "c5",
				platform: "web" as const,
				url: "https://example.com/5",
				evidence: "ev",
				confidence: 0.4,
			},
			{
				creatorName: "C6",
				handle: "c6",
				platform: "web" as const,
				url: "https://example.com/6",
				evidence: "ev",
				confidence: 0.1,
			},
		];

		const result = postProcessCandidates(input);
		expect(result).toHaveLength(5);
		expect(result.map((r) => r.handle)).toEqual(["c2", "c4", "c3", "c5", "c1"]);
		expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
	});
});

describeWithDb("runAttribution database integration", () => {
	let fakeS3: ReturnType<typeof installFakeS3>;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		process.env.OPENROUTER_API_KEY = "sk-or-test";
		resetEnvCache();
	});

	afterEach(() => {
		fakeS3.restore();
		vi.restoreAllMocks();
		setReverseImageSearchProvider(undefined);
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();
	});

	it("runs attribution search, post-processes candidates, and stores in database", async () => {
		const meme = await createMeme({
			ocrText: "Original artwork by @sarahscribbles",
		});

		// Put a 1x1 PNG in fake S3 for display image
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
			"base64",
		);
		fakeS3.upload(memeKey(meme.id, "display"), pngBytes, "image/webp");

		// Create an existing unconfirmed candidate that should be replaced
		await db().attributionCandidate.create({
			data: {
				memeId: meme.id,
				creatorName: "Old Stale Candidate",
				handle: "stale_handle",
				platform: "web",
				evidence: "old",
				confidence: 0.1,
				rank: 1,
			},
		});

		// Create a rejected candidate that should NOT be deleted
		await db().attributionCandidate.create({
			data: {
				memeId: meme.id,
				creatorName: "Rejected Creator",
				handle: "rejected_handle",
				platform: "other",
				evidence: "rejected",
				confidence: 0.2,
				rank: 2,
				rejectedAt: new Date("2026-11-01T00:00:00Z"),
			},
		});

		// Mock OpenRouter response
		const openRouterResponse = {
			model: "google/gemini-3.8-flash",
			choices: [
				{
					message: {
						content: JSON.stringify({
							candidates: [
								{
									creatorName: "Sarah Andersen",
									handle: "sarahscribbles",
									platform: "instagram",
									url: "https://instagram.com/sarahscribbles",
									evidence: "Artist behind the comic series",
									confidence: 0.95,
								},
								{
									creatorName: "9GAG Aggregator",
									handle: "9gag",
									platform: "ninegag",
									url: "https://9gag.com/gag/123",
									evidence: "Reposter",
									confidence: 0.88,
								},
							],
						}),
					},
				},
			],
			citations: ["https://instagram.com/sarahscribbles"],
			usage: {
				prompt_tokens: 500,
				completion_tokens: 100,
				cost: 0.015,
			},
		};

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(openRouterResponse, { status: 200 })),
		);

		await runAttribution(meme.id);

		// Verify candidates in database
		const candidates = await db().attributionCandidate.findMany({
			where: { memeId: meme.id },
			orderBy: { rank: "asc" },
		});

		// Should have the new sarahscribbles candidate + the preserved rejected candidate
		// (stale_handle must be deleted because it was unconfirmed and unrejected)
		const handles = candidates.map((c) => c.handle);
		expect(handles).toContain("sarahscribbles");
		expect(handles).toContain("rejected_handle");
		expect(handles).not.toContain("stale_handle");
		expect(handles).not.toContain("9gag"); // filtered out by postProcessCandidates!

		const sarah = candidates.find((c) => c.handle === "sarahscribbles");
		expect(sarah?.rank).toBe(1);
		expect(sarah?.confidence).toBe(0.95);

		// Verify analysis row
		const analysis = await db().analysis.findFirst({
			where: { memeId: meme.id, kind: "attribution" },
		});
		expect(analysis?.status).toBe("done");
		expect(analysis?.costUsd).toBe(0.015);
		const result = analysis?.result as { citations?: string[] };
		expect(result?.citations).toEqual(["https://instagram.com/sarahscribbles"]);
	});
});
