import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as confirmPost } from "@/app/api/memes/[id]/attribution/[candidateId]/confirm/route";
import { POST as rejectPost } from "@/app/api/memes/[id]/attribution/[candidateId]/reject/route";
import type { MemeDetailDto } from "@/lib/api/types";
import { requestAttribution } from "@/lib/attribution/request";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { getMemeDetail } from "@/lib/memes/service";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { apiRequest, json, routeParams } from "@/test/helpers/http";

describeWithDb("Attribution API routes and service", () => {
	beforeEach(async () => {
		await resetDb();
		process.env.OPENROUTER_API_KEY = "sk-or-test";
		resetEnvCache();
	});

	afterEach(() => {
		delete process.env.OPENROUTER_API_KEY;
		resetEnvCache();
	});

	describe("POST /api/memes/[id]/attribution/[candidateId]/confirm", () => {
		it("returns 401 when unauthenticated", async () => {
			const req = apiRequest(
				"/api/memes/0193290b-8d00-7000-8000-000000000001/attribution/0193290b-8d00-7000-8000-000000000011/confirm",
				{ method: "POST", user: null },
			);
			const res = await confirmPost(
				req,
				routeParams({
					id: "0193290b-8d00-7000-8000-000000000001",
					candidateId: "0193290b-8d00-7000-8000-000000000011",
				}),
			);
			expect(res.status).toBe(401);
		});

		it("returns 404 if meme or candidate does not exist", async () => {
			const meme = await createMeme();
			const req = apiRequest(
				`/api/memes/${meme.id}/attribution/0193290b-8d00-7000-8000-000000000099/confirm`,
				{ method: "POST" },
			);
			const res = await confirmPost(
				req,
				routeParams({
					id: meme.id,
					candidateId: "0193290b-8d00-7000-8000-000000000099",
				}),
			);
			expect(res.status).toBe(404);
		});

		it("confirms candidate, sets creditText, and stamps confirmedAt", async () => {
			const meme = await createMeme();
			const candidate = await db().attributionCandidate.create({
				data: {
					memeId: meme.id,
					creatorName: "Sarah Andersen",
					handle: "sarahscribbles",
					platform: "instagram",
					url: "https://instagram.com/sarahscribbles",
					evidence: "Original artist",
					confidence: 0.95,
					rank: 1,
				},
			});

			const req = apiRequest(
				`/api/memes/${meme.id}/attribution/${candidate.id}/confirm`,
				{ method: "POST" },
			);
			const res = await confirmPost(
				req,
				routeParams({ id: meme.id, candidateId: candidate.id }),
			);
			expect(res.status).toBe(200);

			const body = await json<MemeDetailDto>(res);
			expect(body.hasAttribution).toBe(true);
			expect(body.creditText).toBe("@sarahscribbles on Instagram");
			expect(body.attribution?.id).toBe(candidate.id);
			expect(body.attribution?.confirmedAt).toBeTruthy();

			// Verify in db
			const updatedMeme = await db().meme.findUnique({
				where: { id: meme.id },
			});
			expect(updatedMeme?.attributionId).toBe(candidate.id);
			expect(updatedMeme?.creditText).toBe("@sarahscribbles on Instagram");

			// Verify audit event
			const auditEvent = await db().auditEvent.findFirst({
				where: { action: "attribution.confirm", subjectId: meme.id },
			});
			expect(auditEvent).toBeTruthy();
			expect(typeof auditEvent?.actorId).toBe("string");
		});

		it("returns exactly the DTO that GET /memes/{id} serves", async () => {
			const meme = await createMeme();
			const candidate = await db().attributionCandidate.create({
				data: {
					memeId: meme.id,
					handle: "same_shape",
					platform: "tumblr",
					evidence: "ev",
					confidence: 0.7,
					rank: 1,
				},
			});
			const res = await confirmPost(
				apiRequest(
					`/api/memes/${meme.id}/attribution/${candidate.id}/confirm`,
					{
						method: "POST",
					},
				),
				routeParams({ id: meme.id, candidateId: candidate.id }),
			);
			const body = await json<MemeDetailDto>(res);
			expect(body).toEqual(await getMemeDetail(meme.id));
			expect(body.candidates[0]).toEqual(body.attribution);
		});

		it("two concurrent confirms leave exactly one candidate confirmed", async () => {
			const meme = await createMeme();
			const make = (handle: string, rank: number) =>
				db().attributionCandidate.create({
					data: {
						memeId: meme.id,
						handle,
						platform: "x",
						evidence: "ev",
						confidence: 0.5,
						rank,
					},
				});
			const a = await make("one", 1);
			const b = await make("two", 2);
			await Promise.all(
				[a, b].map((c) =>
					confirmPost(
						apiRequest(`/api/memes/${meme.id}/attribution/${c.id}/confirm`, {
							method: "POST",
						}),
						routeParams({ id: meme.id, candidateId: c.id }),
					),
				),
			);
			const confirmed = await db().attributionCandidate.findMany({
				where: { memeId: meme.id, confirmedAt: { not: null } },
			});
			const after = await db().meme.findUnique({ where: { id: meme.id } });
			expect(confirmed).toHaveLength(1);
			expect(after?.attributionId).toBe(confirmed[0]?.id);
		});

		it("confirming another candidate replaces the first", async () => {
			const meme = await createMeme();
			const candidate1 = await db().attributionCandidate.create({
				data: {
					memeId: meme.id,
					creatorName: "Creator 1",
					handle: "creator1",
					platform: "x",
					url: "https://x.com/creator1",
					evidence: "Source 1",
					confidence: 0.8,
					rank: 1,
				},
			});
			const candidate2 = await db().attributionCandidate.create({
				data: {
					memeId: meme.id,
					creatorName: "Creator 2",
					handle: "creator2",
					platform: "reddit",
					url: "https://reddit.com/u/creator2",
					evidence: "Source 2",
					confidence: 0.85,
					rank: 2,
				},
			});

			// Confirm 1
			await confirmPost(
				apiRequest(
					`/api/memes/${meme.id}/attribution/${candidate1.id}/confirm`,
					{ method: "POST" },
				),
				routeParams({ id: meme.id, candidateId: candidate1.id }),
			);

			// Confirm 2 (replaces 1)
			const res = await confirmPost(
				apiRequest(
					`/api/memes/${meme.id}/attribution/${candidate2.id}/confirm`,
					{ method: "POST" },
				),
				routeParams({ id: meme.id, candidateId: candidate2.id }),
			);
			expect(res.status).toBe(200);

			const body = await json<MemeDetailDto>(res);
			expect(body.creditText).toBe("@creator2 on Reddit");
			expect(body.attribution?.id).toBe(candidate2.id);

			// Candidate 1 should have confirmedAt cleared
			const c1 = await db().attributionCandidate.findUnique({
				where: { id: candidate1.id },
			});
			expect(c1?.confirmedAt).toBeNull();

			// Candidate 2 should be confirmed
			const c2 = await db().attributionCandidate.findUnique({
				where: { id: candidate2.id },
			});
			expect(c2?.confirmedAt).not.toBeNull();
		});
	});

	describe("POST /api/memes/[id]/attribution/[candidateId]/reject", () => {
		it("rejects candidate and clears meme attribution if it was confirmed", async () => {
			const meme = await createMeme();
			const candidate = await db().attributionCandidate.create({
				data: {
					memeId: meme.id,
					creatorName: "Creator",
					handle: "creator",
					platform: "instagram",
					evidence: "evidence",
					confidence: 0.7,
					rank: 1,
				},
			});

			// Confirm it first
			await confirmPost(
				apiRequest(
					`/api/memes/${meme.id}/attribution/${candidate.id}/confirm`,
					{ method: "POST" },
				),
				routeParams({ id: meme.id, candidateId: candidate.id }),
			);

			// Now reject it
			const res = await rejectPost(
				apiRequest(`/api/memes/${meme.id}/attribution/${candidate.id}/reject`, {
					method: "POST",
				}),
				routeParams({ id: meme.id, candidateId: candidate.id }),
			);
			expect(res.status).toBe(200);

			const body = await json<MemeDetailDto>(res);
			expect(body.hasAttribution).toBe(false);
			expect(body.creditText).toBeNull();
			expect(body.attribution).toBeNull();

			const updatedCandidate = await db().attributionCandidate.findUnique({
				where: { id: candidate.id },
			});
			expect(updatedCandidate?.rejectedAt).not.toBeNull();
			expect(updatedCandidate?.confirmedAt).toBeNull();

			// Verify audit event
			const auditEvent = await db().auditEvent.findFirst({
				where: { action: "attribution.reject", subjectId: meme.id },
			});
			expect(auditEvent).toBeTruthy();
		});
	});

	describe("requestAttribution service", () => {
		it("creates a queued Analysis, enqueues job, audits, and returns AnalysisDto", async () => {
			const meme = await createMeme();
			const actorId = randomUUID();
			const analysis = await requestAttribution(meme.id, actorId);

			expect(analysis.memeId).toBe(meme.id);
			expect(analysis.kind).toBe("attribution");
			expect(analysis.status).toBe("queued");

			const inDb = await db().analysis.findUnique({
				where: { id: analysis.id },
			});
			expect(inDb).toBeTruthy();
			expect(inDb?.status).toBe("queued");

			const auditEvent = await db().auditEvent.findFirst({
				where: { action: "attribution.request", subjectId: meme.id },
			});
			expect(auditEvent).toBeTruthy();
			expect(auditEvent?.actorId).toBe(actorId);
		});

		it("throws 503 if OpenRouter AI is not configured", async () => {
			delete process.env.OPENROUTER_API_KEY;
			resetEnvCache();

			const meme = await createMeme();
			await expect(requestAttribution(meme.id, randomUUID())).rejects.toThrow(
				/OpenRouter is not configured/,
			);
		});

		it("throws 409 conflict if an attribution analysis is already queued or running", async () => {
			const meme = await createMeme();
			const actorId = randomUUID();
			await requestAttribution(meme.id, actorId);

			await expect(requestAttribution(meme.id, actorId)).rejects.toThrow(
				/already in progress/,
			);
		});

		it("throws 404 if meme does not exist", async () => {
			await expect(
				requestAttribution(
					"0193290b-8d00-7000-8000-000000000099",
					randomUUID(),
				),
			).rejects.toThrow(/not found/i);
		});
	});
});
