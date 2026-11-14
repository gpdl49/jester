import { beforeEach, expect, it, vi } from "vitest";
import * as ai from "@/lib/ai";
import { db } from "@/lib/db";
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
