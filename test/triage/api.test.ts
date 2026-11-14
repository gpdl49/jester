import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getPreview } from "@/app/api/triage/[id]/preview/route";
import { POST as resetTriage } from "@/app/api/triage/[id]/reset/route";
import { POST as acceptAbove } from "@/app/api/triage/accept-above/route";
import { POST as postDecisions } from "@/app/api/triage/decisions/route";
import { GET as getTriage } from "@/app/api/triage/route";
import type { Paged, TriageCandidateDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { importImmich } from "@/lib/jobs/definitions/import-immich";
import { enqueue, stopBoss } from "@/lib/jobs/queue";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { fakeAsset, installFakeImmich } from "@/test/helpers/immich";
import { ADMIN_USER, userId } from "@/test/helpers/users";

describeWithDb("Triage API routes", () => {
	beforeEach(async () => {
		await resetDb();
	});

	describe("GET /api/triage", () => {
		it("requires authentication (401 for unauthenticated)", async () => {
			const req = apiRequest("/api/triage", { user: null });
			const res = await getTriage(req, {});
			expect(res.status).toBe(401);
		});

		it("returns scored candidates ordered by probability desc with previewUrl", async () => {
			const a1 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.7,
			});
			const a2 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.95,
			});
			const a3 = await createImmichAsset({
				triageStatus: "rejected",
				memeProbability: 0.1,
			});

			const req = apiRequest("/api/triage", { user: TEST_USER });
			const res = await getTriage(req, {});
			expect(res.status).toBe(200);

			const body = await json<Paged<TriageCandidateDto>>(res);
			expect(body.items).toHaveLength(2);
			// 0.95 comes before 0.7
			expect(body.items[0]?.id).toBe(a2.id);
			expect(body.items[0]?.memeProbability).toBe(0.95);
			expect(body.items[0]?.previewUrl).toBe(`/api/triage/${a2.id}/preview`);
			expect(body.items[1]?.id).toBe(a1.id);
			// rejected is excluded by default scored status
			expect(body.items.some((i) => i.id === a3.id)).toBe(false);
		});

		it("filters by status and minProbability", async () => {
			await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.4,
			});
			const high = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.85,
			});
			const pending = await createImmichAsset({
				triageStatus: "pending",
				memeProbability: null,
			});

			// filter minProbability
			const resProb = await getTriage(
				apiRequest("/api/triage?status=scored&minProbability=0.8", {
					user: TEST_USER,
				}),
				{},
			);
			const bodyProb = await json<Paged<TriageCandidateDto>>(resProb);
			expect(bodyProb.items).toHaveLength(1);
			expect(bodyProb.items[0]?.id).toBe(high.id);

			// filter status=pending
			const resPending = await getTriage(
				apiRequest("/api/triage?status=pending", { user: TEST_USER }),
				{},
			);
			const bodyPending = await json<Paged<TriageCandidateDto>>(resPending);
			expect(bodyPending.items).toHaveLength(1);
			expect(bodyPending.items[0]?.id).toBe(pending.id);
		});

		it("supports cursor pagination", async () => {
			const a1 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.9,
			});
			const a2 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.8,
			});
			const a3 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.7,
			});

			const page1Res = await getTriage(
				apiRequest("/api/triage?limit=2", { user: TEST_USER }),
				{},
			);
			const page1 = await json<Paged<TriageCandidateDto>>(page1Res);
			expect(page1.items).toHaveLength(2);
			expect(page1.items[0]?.id).toBe(a1.id);
			expect(page1.items[1]?.id).toBe(a2.id);
			expect(page1.nextCursor).toBe(a2.id);

			const page2Res = await getTriage(
				apiRequest(`/api/triage?limit=2&cursor=${page1.nextCursor}`, {
					user: TEST_USER,
				}),
				{},
			);
			const page2 = await json<Paged<TriageCandidateDto>>(page2Res);
			expect(page2.items).toHaveLength(1);
			expect(page2.items[0]?.id).toBe(a3.id);
			expect(page2.nextCursor).toBeNull();
		});
	});

	describe("POST /api/triage/decisions", () => {
		it("requires authentication (401)", async () => {
			const res = await postDecisions(
				apiRequest("/api/triage/decisions", {
					method: "POST",
					user: null,
					body: { decisions: [] },
				}),
				{},
			);
			expect(res.status).toBe(401);
		});

		it("handles bulk accept and reject decisions idempotently and creates audit events", async () => {
			const actorId = await userId(TEST_USER);
			const asset1 = await createImmichAsset({ triageStatus: "scored" });
			const asset2 = await createImmichAsset({ triageStatus: "scored" });

			const res = await postDecisions(
				apiRequest("/api/triage/decisions", {
					method: "POST",
					user: TEST_USER,
					body: {
						decisions: [
							{ immichAssetId: asset1.id, decision: "accept" },
							{ immichAssetId: asset2.id, decision: "reject" },
						],
					},
				}),
				{},
			);
			expect(res.status).toBe(200);
			const body = await json<{ accepted: number; rejected: number }>(res);
			expect(body).toEqual({ accepted: 1, rejected: 1 });

			// Verify DB state
			const updated1 = await db().immichAsset.findUnique({
				where: { id: asset1.id },
			});
			expect(updated1?.triageStatus).toBe("accepted");
			expect(updated1?.decidedById).toBe(actorId);
			expect(updated1?.decidedAt).not.toBeNull();

			const updated2 = await db().immichAsset.findUnique({
				where: { id: asset2.id },
			});
			expect(updated2?.triageStatus).toBe("rejected");
			expect(updated2?.decidedById).toBe(actorId);
			expect(updated2?.decidedAt).not.toBeNull();

			// Audit events created
			const audits = await db().auditEvent.findMany({
				where: { subjectId: { in: [asset1.id, asset2.id] } },
			});
			expect(audits).toHaveLength(2);
			expect(audits.map((a) => a.action).sort()).toEqual([
				"triage.accept",
				"triage.reject",
			]);

			// Repeating decisions is idempotent and no-op
			const repeatRes = await postDecisions(
				apiRequest("/api/triage/decisions", {
					method: "POST",
					user: TEST_USER,
					body: {
						decisions: [
							{ immichAssetId: asset1.id, decision: "accept" },
							{ immichAssetId: asset2.id, decision: "reject" },
						],
					},
				}),
				{},
			);
			const repeatBody = await json<{ accepted: number; rejected: number }>(
				repeatRes,
			);
			expect(repeatBody).toEqual({ accepted: 0, rejected: 0 });
		});

		it("skips non-decidable assets in bulk", async () => {
			const imported = await createImmichAsset({ triageStatus: "imported" });
			const scored = await createImmichAsset({ triageStatus: "scored" });

			const res = await postDecisions(
				apiRequest("/api/triage/decisions", {
					method: "POST",
					user: TEST_USER,
					body: {
						decisions: [
							{ immichAssetId: imported.id, decision: "accept" },
							{ immichAssetId: scored.id, decision: "accept" },
						],
					},
				}),
				{},
			);
			expect(res.status).toBe(200);
			const body = await json<{ accepted: number; rejected: number }>(res);
			expect(body.accepted).toBe(1);

			const untouchedImported = await db().immichAsset.findUnique({
				where: { id: imported.id },
			});
			expect(untouchedImported?.triageStatus).toBe("imported");
		});
	});

	describe("POST /api/triage/accept-above", () => {
		it("requires admin (403 for non-admin)", async () => {
			const res = await acceptAbove(
				apiRequest("/api/triage/accept-above", {
					method: "POST",
					user: TEST_USER,
					body: { minProbability: 0.8 },
				}),
				{},
			);
			expect(res.status).toBe(403);
		});

		it("accepts all scored candidates with probability >= threshold", async () => {
			const a1 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.85,
			});
			const a2 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.95,
			});
			const a3 = await createImmichAsset({
				triageStatus: "scored",
				memeProbability: 0.75,
			});

			const res = await acceptAbove(
				apiRequest("/api/triage/accept-above", {
					method: "POST",
					user: ADMIN_USER,
					body: { minProbability: 0.8 },
				}),
				{},
			);
			expect(res.status).toBe(200);
			const body = await json<{ accepted: number }>(res);
			expect(body.accepted).toBe(2);

			const updated1 = await db().immichAsset.findUnique({
				where: { id: a1.id },
			});
			expect(updated1?.triageStatus).toBe("accepted");

			const updated2 = await db().immichAsset.findUnique({
				where: { id: a2.id },
			});
			expect(updated2?.triageStatus).toBe("accepted");

			const updated3 = await db().immichAsset.findUnique({
				where: { id: a3.id },
			});
			expect(updated3?.triageStatus).toBe("scored");
		});
	});

	describe("POST /api/triage/[id]/reset", () => {
		afterAll(async () => {
			await stopBoss();
		});

		const reset = (id: string) =>
			resetTriage(
				apiRequest(`/api/triage/${id}/reset`, {
					method: "POST",
					user: ADMIN_USER,
				}),
				routeParams({ id }),
			);

		it("returns 409 and changes nothing while the asset's import job is running", async () => {
			const asset = await createImmichAsset({
				triageStatus: "accepted",
				memeProbability: 0.9,
			});
			await enqueue(importImmich, { immichAssetId: asset.id });
			await db().$executeRaw`
				UPDATE pgboss.job SET state = 'active'
				WHERE name = 'import.immich' AND data->>'immichAssetId' = ${asset.id}`;

			const res = await reset(asset.id);

			expect(res.status).toBe(409);
			expect(
				(await db().immichAsset.findUniqueOrThrow({ where: { id: asset.id } }))
					.triageStatus,
			).toBe("accepted");
		});

		it("still resets an accepted asset whose import job is only queued", async () => {
			const asset = await createImmichAsset({
				triageStatus: "accepted",
				memeProbability: 0.9,
			});
			await enqueue(importImmich, { immichAssetId: asset.id });

			const res = await reset(asset.id);

			expect(res.status).toBe(200);
			expect((await json<TriageCandidateDto>(res)).triageStatus).toBe("scored");
		});

		it("requires admin (403 for non-admin)", async () => {
			const asset = await createImmichAsset({ triageStatus: "rejected" });
			const res = await resetTriage(
				apiRequest(`/api/triage/${asset.id}/reset`, {
					method: "POST",
					user: TEST_USER,
				}),
				routeParams({ id: asset.id }),
			);
			expect(res.status).toBe(403);
		});

		it("resets to scored if memeProbability exists", async () => {
			const asset = await createImmichAsset({
				triageStatus: "rejected",
				memeProbability: 0.65,
				decidedAt: new Date(),
			});

			const res = await resetTriage(
				apiRequest(`/api/triage/${asset.id}/reset`, {
					method: "POST",
					user: ADMIN_USER,
				}),
				routeParams({ id: asset.id }),
			);
			expect(res.status).toBe(200);
			const body = await json<TriageCandidateDto>(res);
			expect(body.triageStatus).toBe("scored");
			expect(body.id).toBe(asset.id);

			const inDb = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(inDb?.triageStatus).toBe("scored");
			expect(inDb?.decidedAt).toBeNull();
			expect(inDb?.decidedById).toBeNull();
		});

		it("resets to pending if memeProbability is null", async () => {
			const asset = await createImmichAsset({
				triageStatus: "error",
				memeProbability: null,
				error: "failed earlier",
			});

			const res = await resetTriage(
				apiRequest(`/api/triage/${asset.id}/reset`, {
					method: "POST",
					user: ADMIN_USER,
				}),
				routeParams({ id: asset.id }),
			);
			expect(res.status).toBe(200);
			const body = await json<TriageCandidateDto>(res);
			expect(body.triageStatus).toBe("pending");
			expect(body.error).toBeNull();
		});

		it("returns 409 if already imported", async () => {
			const meme = await createMeme();
			const asset = await createImmichAsset({
				triageStatus: "imported",
				memeId: meme.id,
			});

			const res = await resetTriage(
				apiRequest(`/api/triage/${asset.id}/reset`, {
					method: "POST",
					user: ADMIN_USER,
				}),
				routeParams({ id: asset.id }),
			);
			expect(res.status).toBe(409);
		});
	});

	describe("GET /api/triage/[id]/preview", () => {
		it("returns 404 when asset does not exist in DB", async () => {
			const fakeId = "01932cf3-4c91-7f99-a991-884c78491999";
			const res = await getPreview(
				apiRequest(`/api/triage/${fakeId}/preview`, { user: TEST_USER }),
				routeParams({ id: fakeId }),
			);
			expect(res.status).toBe(404);
		});

		it("proxies thumbnail bytes with Cache-Control private max-age=3600", async () => {
			const fakeImmich = installFakeImmich();
			const fake = fakeAsset();
			fakeImmich.add(fake);

			const asset = await createImmichAsset({
				immichId: fake.id,
			});

			try {
				const res = await getPreview(
					apiRequest(`/api/triage/${asset.id}/preview`, { user: TEST_USER }),
					routeParams({ id: asset.id }),
				);
				expect(res.status).toBe(200);
				expect(res.headers.get("Content-Type")).toBe("image/jpeg");
				expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
				const buffer = await res.arrayBuffer();
				expect(new Uint8Array(buffer)).toEqual(fake.bytes);
			} finally {
				fakeImmich.restore();
			}
		});

		it("returns 404 when thumbnail is gone in Immich", async () => {
			const fakeImmich = installFakeImmich([]);
			const asset = await createImmichAsset();

			try {
				const res = await getPreview(
					apiRequest(`/api/triage/${asset.id}/preview`, { user: TEST_USER }),
					routeParams({ id: asset.id }),
				);
				expect(res.status).toBe(404);
			} finally {
				fakeImmich.restore();
			}
		});
	});
});

describeWithDb("Triage decisions: concurrency", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("a concurrent accept and reject of one asset has exactly one winner and one import enqueue", async () => {
		const asset = await createImmichAsset({ triageStatus: "scored" });
		const send = (decision: "accept" | "reject") =>
			postDecisions(
				apiRequest("/api/triage/decisions", {
					method: "POST",
					user: TEST_USER,
					body: { decisions: [{ immichAssetId: asset.id, decision }] },
				}),
				{},
			).then((r) => json<{ accepted: number; rejected: number }>(r));

		const [a, b] = await Promise.all([send("accept"), send("reject")]);
		expect(a.accepted + a.rejected + b.accepted + b.rejected).toBe(1);

		const row = await db().immichAsset.findUnique({ where: { id: asset.id } });
		const audits = await db().auditEvent.count({
			where: { subjectId: asset.id },
		});
		expect(audits).toBe(1);
		expect(["accepted", "rejected"]).toContain(row?.triageStatus);
		// The audit trail must agree with the final state.
		const audit = await db().auditEvent.findFirst({
			where: { subjectId: asset.id },
		});
		expect(audit?.action).toBe(
			row?.triageStatus === "accepted" ? "triage.accept" : "triage.reject",
		);
	});

	it("a rejected asset can't be accepted by a late decision", async () => {
		const asset = await createImmichAsset({ triageStatus: "rejected" });
		const res = await postDecisions(
			apiRequest("/api/triage/decisions", {
				method: "POST",
				user: TEST_USER,
				body: { decisions: [{ immichAssetId: asset.id, decision: "accept" }] },
			}),
			{},
		);
		expect(await json(res)).toEqual({ accepted: 0, rejected: 0 });
		const row = await db().immichAsset.findUnique({ where: { id: asset.id } });
		expect(row?.triageStatus).toBe("rejected");
	});
});
