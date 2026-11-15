import { afterAll, beforeEach, expect, it, vi } from "vitest";
import * as ai from "@/lib/ai";
import { db } from "@/lib/db";
import { featureDisabled } from "@/lib/http/errors";
import { stopBoss } from "@/lib/jobs/queue";
import { runTriage } from "@/lib/triage/classify";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset } from "@/test/helpers/factories";
import { fakeAsset, installFakeImmich } from "@/test/helpers/immich";

describeWithDb("Triage Classifier (runTriage)", () => {
	beforeEach(async () => {
		await resetDb();
		vi.restoreAllMocks();
	});

	it("classifies asset, clamps probability, updates asset and records analysis", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
			memeProbability: null,
		});

		vi.spyOn(ai, "aiCall").mockResolvedValueOnce({
			model: "google/gemini-3.5-f",
			content: JSON.stringify({
				memeProbability: 1.2, // will be clamped to 1.0
				kind: "meme",
				reason: "Top and bottom impact font on cat",
			}),
			usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 },
			citations: [],
		});

		try {
			await runTriage(asset.id);

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("scored");
			expect(updated?.memeProbability).toBe(1.0);
			expect(updated?.triageModel).toBe("google/gemini-3.5-f");
			expect(updated?.triageResult).toEqual({
				memeProbability: 1.0,
				kind: "meme",
				reason: "Top and bottom impact font on cat",
			});

			const analysis = await db().analysis.findFirst({
				where: { kind: "triage" },
			});
			expect(analysis).not.toBeNull();
			expect(analysis?.memeId).toBeNull();
			expect(analysis?.status).toBe("done");
			expect(analysis?.model).toBe("google/gemini-3.5-f");
			expect(analysis?.costUsd).toBe(0.0004);
		} finally {
			fakeImmich.restore();
		}
	});

	it("auto-accepts as system when probability is >= triage.autoAcceptThreshold", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
			memeProbability: null,
		});

		// Set auto-accept setting to 0.8
		await db().setting.upsert({
			where: { key: "triage.autoAcceptThreshold" },
			create: { key: "triage.autoAcceptThreshold", value: 0.8 },
			update: { value: 0.8 },
		});

		vi.spyOn(ai, "aiCall").mockResolvedValueOnce({
			model: "google/gemini-3.5-f",
			content: JSON.stringify({
				memeProbability: 0.85,
				kind: "meme",
				reason: "High quality meme",
			}),
			usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 },
			citations: [],
		});

		try {
			await runTriage(asset.id);

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("accepted");
			expect(updated?.decidedById).toBeNull();
			expect(updated?.decidedAt).not.toBeNull();

			// Audit event for system auto-accept
			const audit = await db().auditEvent.findFirst({
				where: { subjectId: asset.id, action: "triage.accept" },
			});
			expect(audit).not.toBeNull();
			expect(audit?.actorId).toBeNull();
		} finally {
			fakeImmich.restore();
		}
	});

	it("does not auto-accept when probability is below threshold", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
			memeProbability: null,
		});

		await db().setting.upsert({
			where: { key: "triage.autoAcceptThreshold" },
			create: { key: "triage.autoAcceptThreshold", value: 0.8 },
			update: { value: 0.8 },
		});

		vi.spyOn(ai, "aiCall").mockResolvedValueOnce({
			model: "google/gemini-3.5-f",
			content: JSON.stringify({
				memeProbability: 0.75,
				kind: "meme",
				reason: "Marginal meme",
			}),
			usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 },
			citations: [],
		});

		try {
			await runTriage(asset.id);

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("scored");
			expect(updated?.decidedAt).toBeNull();
		} finally {
			fakeImmich.restore();
		}
	});

	it("marks error 'gone' on Immich 404 without rethrowing", async () => {
		const fakeImmich = installFakeImmich([]);
		const asset = await createImmichAsset({
			triageStatus: "pending",
		});

		try {
			await runTriage(asset.id);

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("error");
			expect(updated?.error).toBe("gone");
		} finally {
			fakeImmich.restore();
		}
	});

	afterAll(async () => {
		await stopBoss();
	});

	it.each([
		["AI is disabled", featureDisabled("OpenRouter")],
		["AI is paused", featureDisabled("AI (paused in settings)")],
	])(
		"defers an hour and keeps pending when %s (503), even on the last attempt",
		async (_name, error) => {
			const fakeImmich = installFakeImmich();
			const fake = fakeAsset();
			fakeImmich.add(fake);
			const asset = await createImmichAsset({
				immichId: fake.id,
				triageStatus: "pending",
			});
			vi.spyOn(ai, "aiCall").mockRejectedValueOnce(error);

			try {
				await runTriage(asset.id, { isLastAttempt: true });

				const updated = await db().immichAsset.findUnique({
					where: { id: asset.id },
				});
				expect(updated?.triageStatus).toBe("pending");
				expect(updated?.error).toBeNull();

				const jobs = await db().$queryRaw<{ wait: number }[]>`
				SELECT EXTRACT(EPOCH FROM (start_after - now()))::float AS wait
				FROM pgboss.job
				WHERE name = 'triage.classify' AND data->>'immichAssetId' = ${asset.id}`;
				expect(jobs).toHaveLength(1);
				expect(jobs[0]?.wait).toBeGreaterThan(3500);
				// startAfter comes from the app clock, now() from Postgres: allow skew.
				expect(jobs[0]?.wait).toBeLessThanOrEqual(3601);
			} finally {
				fakeImmich.restore();
			}
		},
	);

	it("keeps pending on BudgetExceededError without failing", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
		});

		vi.spyOn(ai, "aiCall").mockRejectedValueOnce(
			new ai.BudgetExceededError(3.05, 3.0),
		);

		try {
			await runTriage(asset.id);

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("pending");
		} finally {
			fakeImmich.restore();
		}
	});

	it("rethrows error on non-final attempt without setting error status", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
		});

		vi.spyOn(ai, "aiCall").mockRejectedValueOnce(
			new Error("OpenRouter 503 transient"),
		);

		try {
			await expect(
				runTriage(asset.id, { retryCount: 0, retryLimit: 2 }),
			).rejects.toThrow("OpenRouter 503 transient");

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("pending");
		} finally {
			fakeImmich.restore();
		}
	});

	it("sets error status on last attempt and rethrows", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);

		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
		});

		vi.spyOn(ai, "aiCall").mockRejectedValueOnce(
			new Error("Persistent failure"),
		);

		try {
			await expect(
				runTriage(asset.id, { retryCount: 2, retryLimit: 2 }),
			).rejects.toThrow("Persistent failure");

			const updated = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(updated?.triageStatus).toBe("error");
			expect(updated?.error).toBe("Persistent failure");
		} finally {
			fakeImmich.restore();
		}
	});
});

describeWithDb("runTriage: decisions made while the model runs", () => {
	beforeEach(async () => {
		await resetDb();
		vi.restoreAllMocks();
	});

	it("does not overwrite a rejection made during the AI call", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);
		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
		});
		vi.spyOn(ai, "aiCall").mockImplementationOnce(async () => {
			await db().immichAsset.update({
				where: { id: asset.id },
				data: { triageStatus: "rejected" },
			});
			return {
				model: "m",
				content: JSON.stringify({
					memeProbability: 0.9,
					kind: "meme",
					reason: "r",
				}),
				citations: [],
			};
		});
		try {
			await runTriage(asset.id);
			const row = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(row?.triageStatus).toBe("rejected");
		} finally {
			fakeImmich.restore();
		}
	});

	it("sets error on the last attempt when the model returns schema-invalid JSON", async () => {
		const fakeImmich = installFakeImmich();
		const fake = fakeAsset();
		fakeImmich.add(fake);
		const asset = await createImmichAsset({
			immichId: fake.id,
			triageStatus: "pending",
		});
		vi.spyOn(ai, "aiCall").mockResolvedValueOnce({
			model: "m",
			content: JSON.stringify({ kind: "meme" }),
			citations: [],
		});
		try {
			await expect(
				runTriage(asset.id, { isLastAttempt: true }),
			).rejects.toThrow();
			const row = await db().immichAsset.findUnique({
				where: { id: asset.id },
			});
			expect(row?.triageStatus).toBe("error");
		} finally {
			fakeImmich.restore();
		}
	});
});
