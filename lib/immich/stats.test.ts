import { afterEach, beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { syncStats } from "@/lib/immich/stats";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset } from "@/test/helpers/factories";

describeWithDb("syncStats", () => {
	beforeEach(async () => {
		await resetDb();
	});

	afterEach(async () => {
		await resetDb();
	});

	it("returns default values when no sync has run", async () => {
		const stats = await syncStats();
		expect(stats).toEqual({
			lastRunAt: null,
			lastError: null,
			backfillDone: false,
			backfillPage: 1,
			assetsSeen: 0,
		});
	});

	it("returns correct stats from SyncState and assets count", async () => {
		const now = new Date();
		await db().syncState.create({
			data: {
				id: "immich",
				backfillDone: true,
				backfillPage: 4,
				lastRunAt: now,
				lastError: null,
				cursor: "2026-11-14T12:00:00Z",
			},
		});

		await createImmichAsset();
		await createImmichAsset();

		const stats = await syncStats();
		expect(stats.backfillDone).toBe(true);
		expect(stats.backfillPage).toBe(4);
		expect(stats.lastRunAt).toBe(now.toISOString());
		expect(stats.lastError).toBeNull();
		expect(stats.assetsSeen).toBe(2);
	});
});
