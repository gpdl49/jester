import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/memes/[id]/analyses/route";
import { GET } from "@/app/api/tags/route";
import type { AnalysisDto, TagCountDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import * as queueModule from "@/lib/jobs/queue";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { apiRequest, json, routeParams } from "@/test/helpers/http";

describeWithDb("POST /api/memes/[id]/analyses", () => {
	let enqueueSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		await resetDb();
		enqueueSpy = vi.spyOn(queueModule, "enqueue").mockResolvedValue("job-123");
		process.env.OPENROUTER_API_KEY = "sk-test-key";
		resetEnvCache();
	});

	afterEach(() => {
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();
		vi.restoreAllMocks();
	});

	it("returns 401 when unauthorized", async () => {
		const req = apiRequest(
			"/api/memes/00000000-0000-0000-0000-000000000000/analyses",
			{
				method: "POST",
				user: null,
			},
		);
		const res = await POST(
			req,
			routeParams({ id: "00000000-0000-0000-0000-000000000000" }),
		);
		expect(res.status).toBe(401);
	});

	it("returns 404 when meme is unknown", async () => {
		const req = apiRequest(
			"/api/memes/00000000-0000-0000-0000-000000000000/analyses",
			{
				method: "POST",
				body: { kind: "meme" },
			},
		);
		const res = await POST(
			req,
			routeParams({ id: "00000000-0000-0000-0000-000000000000" }),
		);
		expect(res.status).toBe(404);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("not_found");
	});

	it("returns 503 when OpenRouter is not configured", async () => {
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();

		const meme = await createMeme();
		const req = apiRequest(`/api/memes/${meme.id}/analyses`, {
			method: "POST",
			body: { kind: "meme" },
		});
		const res = await POST(req, routeParams({ id: meme.id }));
		expect(res.status).toBe(503);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("feature_disabled");
	});

	it("returns 429 when daily AI budget is exceeded", async () => {
		await db().setting.upsert({
			where: { key: "ai.dailyBudgetUsd" },
			create: { key: "ai.dailyBudgetUsd", value: 1.0 },
			update: { value: 1.0 },
		});
		await db().aiUsage.create({
			data: {
				kind: "meme",
				model: "mock",
				costUsd: 2.0,
				at: new Date(),
			},
		});

		const meme = await createMeme();
		const req = apiRequest(`/api/memes/${meme.id}/analyses`, {
			method: "POST",
			body: { kind: "meme" },
		});
		const res = await POST(req, routeParams({ id: meme.id }));
		expect(res.status).toBe(429);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("budget_exceeded");
	});

	it("returns 409 when a meme analysis is already queued or running", async () => {
		const meme = await createMeme();
		await db().analysis.create({
			data: {
				memeId: meme.id,
				kind: "meme",
				status: "queued",
			},
		});

		const req = apiRequest(`/api/memes/${meme.id}/analyses`, {
			method: "POST",
			body: { kind: "meme" },
		});
		const res = await POST(req, routeParams({ id: meme.id }));
		expect(res.status).toBe(409);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("conflict");
	});

	it("creates Analysis and enqueues analysis.meme, returning 202", async () => {
		const meme = await createMeme();

		const req = apiRequest(`/api/memes/${meme.id}/analyses`, {
			method: "POST",
			body: { kind: "meme" },
		});
		const res = await POST(req, routeParams({ id: meme.id }));
		expect(res.status).toBe(202);

		const body = await json<AnalysisDto>(res);
		expect(body.memeId).toBe(meme.id);
		expect(body.kind).toBe("meme");
		expect(body.status).toBe("queued");

		expect(enqueueSpy).toHaveBeenCalledOnce();
		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ name: "analysis.meme" }),
			{ memeId: meme.id, analysisId: body.id },
		);
	});

	it("handles kind: attribution, calls requestAttribution, and returns 202", async () => {
		const meme = await createMeme();

		const req = apiRequest(`/api/memes/${meme.id}/analyses`, {
			method: "POST",
			body: { kind: "attribution" },
		});
		const res = await POST(req, routeParams({ id: meme.id }));
		expect(res.status).toBe(202);

		const body = await json<AnalysisDto>(res);
		expect(body.memeId).toBe(meme.id);
		expect(body.kind).toBe("attribution");
		expect(body.status).toBe("queued");

		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ name: "attribution.find" }),
			{ memeId: meme.id, analysisId: body.id },
		);
	});
});

describeWithDb("GET /api/tags", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("returns 401 when unauthorized", async () => {
		const req = apiRequest("/api/tags", { user: null });
		const res = await GET(req, {});
		expect(res.status).toBe(401);
	});

	it("returns tag counts sorted by count desc, name asc (excluding rejected memes)", async () => {
		// Non-rejected memes
		const meme1 = await createMeme({ status: "inbox" });
		const meme2 = await createMeme({ status: "approved" });
		const meme3 = await createMeme({ status: "archived" });
		// Rejected meme
		const memeRejected = await createMeme({ status: "rejected" });

		// Tags
		const tagA = await db().tag.create({
			data: { name: "apple", kind: "topic" },
		});
		const tagB = await db().tag.create({
			data: { name: "banana", kind: "topic" },
		});
		const tagC = await db().tag.create({
			data: { name: "cherry", kind: "style" },
		});
		await db().tag.create({ data: { name: "orphan", kind: "topic" } });
		const tagOnlyRejected = await db().tag.create({
			data: { name: "rejected-only", kind: "topic" },
		});

		// tagA: 3 non-rejected memes (meme1, meme2, meme3)
		await db().memeTag.createMany({
			data: [
				{ memeId: meme1.id, tagId: tagA.id, source: "ai" },
				{ memeId: meme2.id, tagId: tagA.id, source: "ai" },
				{ memeId: meme3.id, tagId: tagA.id, source: "user" },
			],
		});

		// tagB: 2 non-rejected memes (meme1, meme2)
		await db().memeTag.createMany({
			data: [
				{ memeId: meme1.id, tagId: tagB.id, source: "ai" },
				{ memeId: meme2.id, tagId: tagB.id, source: "user" },
			],
		});

		// tagC: 2 non-rejected memes (meme2, meme3) and 1 rejected meme (memeRejected)
		await db().memeTag.createMany({
			data: [
				{ memeId: meme2.id, tagId: tagC.id, source: "ai" },
				{ memeId: meme3.id, tagId: tagC.id, source: "ai" },
				{ memeId: memeRejected.id, tagId: tagC.id, source: "ai" },
			],
		});

		// tagOnlyRejected: only attached to rejected meme
		await db().memeTag.create({
			data: {
				memeId: memeRejected.id,
				tagId: tagOnlyRejected.id,
				source: "ai",
			},
		});

		const req = apiRequest("/api/tags");
		const res = await GET(req, {});
		expect(res.status).toBe(200);

		const tags = await json<TagCountDto[]>(res);

		// tagA has count 3
		// tagB and tagC both have count 2 -> sorted alphabetically: banana, cherry
		// tagOrphan and tagOnlyRejected should NOT appear
		expect(tags).toEqual([
			{ name: "apple", kind: "topic", count: 3 },
			{ name: "banana", kind: "topic", count: 2 },
			{ name: "cherry", kind: "style", count: 2 },
		]);
	});
});
