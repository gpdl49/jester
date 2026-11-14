import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { runScan } from "@/lib/immich/sync";
import { stopBoss } from "@/lib/jobs/queue";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import {
	type FakeImmich,
	fakeAsset,
	installFakeImmich,
} from "@/test/helpers/immich";

describeWithDb("runScan", () => {
	let fakeImmich: FakeImmich;
	const originalApiKey = process.env.IMMICH_API_KEY;

	beforeEach(async () => {
		await resetDb();
		fakeImmich = installFakeImmich();
		process.env.IMMICH_API_KEY = "test-immich-key";
		resetEnvCache();
	});

	afterEach(async () => {
		fakeImmich.restore();
		process.env.IMMICH_API_KEY = originalApiKey;
		resetEnvCache();
		await resetDb();
	});

	afterAll(async () => {
		await stopBoss();
	});

	it("skips cleanly and logs when features().immich is false", async () => {
		process.env.IMMICH_API_KEY = "";
		resetEnvCache();

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runScan();

		expect(logSpy).toHaveBeenCalledWith(
			"[immich] sync skipped: features().immich is false",
		);
		logSpy.mockRestore();

		const count = await db().immichAsset.count();
		expect(count).toBe(0);
	});

	it("backfill: runs smart search, pages metadata, scores assets, sets pending and unscored", async () => {
		// Asset 1: meme screenshot (scores high >= 0.35) -> should be pending
		const asset1 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000001",
			originalFileName: "Screenshot_meme.png",
			originalMimeType: "image/png",
			type: "IMAGE",
			width: 1170,
			height: 2532,
			smartQueries: ["meme"],
			updatedAt: "2026-11-14T10:00:00Z",
		});

		// Asset 2: camera photo (score 0 < 0.35) -> should be unscored
		const asset2 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000002",
			originalFileName: "DSC_0001.JPG",
			originalMimeType: "image/jpeg",
			type: "IMAGE",
			width: 4000,
			height: 3000,
			exifInfo: { make: "Canon", model: "EOS R5" },
			updatedAt: "2026-11-14T11:00:00Z",
		});

		// Asset 3: video -> should be ignored
		const asset3 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000003",
			originalFileName: "video.mp4",
			originalMimeType: "video/mp4",
			type: "VIDEO",
			updatedAt: "2026-11-14T11:30:00Z",
		});

		fakeImmich.add(asset1);
		fakeImmich.add(asset2);
		fakeImmich.add(asset3);

		await runScan("backfill");

		// Asset 1 should be pending
		const row1 = await db().immichAsset.findUnique({
			where: { immichId: asset1.id },
		});
		expect(row1).not.toBeNull();
		expect(row1?.triageStatus).toBe("pending");
		expect(row1?.smartHits).toContain("meme");
		expect(row1?.prefilterScore).toBeGreaterThanOrEqual(0.35);

		// Asset 2 should be unscored
		const row2 = await db().immichAsset.findUnique({
			where: { immichId: asset2.id },
		});
		expect(row2).not.toBeNull();
		expect(row2?.triageStatus).toBe("unscored");
		expect(row2?.prefilterScore).toBe(0);

		// Asset 3 (VIDEO) should not exist in immichAsset
		const row3 = await db().immichAsset.findUnique({
			where: { immichId: asset3.id },
		});
		expect(row3).toBeNull();

		// Verify SyncState
		const syncState = await db().syncState.findUnique({
			where: { id: "immich" },
		});
		expect(syncState?.backfillDone).toBe(true);
		expect(syncState?.smartDone).toBe(true);
		expect(syncState?.cursor).toBe("2026-11-14T11:00:00.000Z");
		expect(syncState?.lastError).toBeNull();
		expect(syncState?.lastRunAt).not.toBeNull();
	});

	it("backfill: marks trashed assets that are not imported as error gone", async () => {
		const trashed = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000004",
			originalFileName: "deleted_pic.jpg",
			originalMimeType: "image/jpeg",
			type: "IMAGE",
			isTrashed: true,
			updatedAt: "2026-11-14T12:00:00Z",
		});
		fakeImmich.add(trashed);

		await runScan("backfill");

		const row = await db().immichAsset.findUnique({
			where: { immichId: trashed.id },
		});
		expect(row?.triageStatus).toBe("error");
		expect(row?.error).toBe("gone");
	});

	it("backfill: resumes from SyncState.backfillPage on subsequent run", async () => {
		// Create 3 assets with different updatedAt
		const a1 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000011",
			originalFileName: "a1.png",
			updatedAt: "2026-11-14T01:00:00Z",
		});
		const a2 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000012",
			originalFileName: "a2.png",
			updatedAt: "2026-11-14T02:00:00Z",
		});
		fakeImmich.add(a1);
		fakeImmich.add(a2);

		// Mock client to return page 1 with nextPage 2, then fail on page 2
		let callCount = 0;
		fakeImmich.client.searchMetadata = async (q) => {
			callCount++;
			if (q.page === 1) {
				return { items: [a1], nextPage: "2" };
			}
			if (q.page === 2 && callCount === 2) {
				throw new Error("Simulated network crash on page 2");
			}
			return { items: [a2], nextPage: null };
		};

		// First run should fail on page 2
		await expect(runScan("backfill")).rejects.toThrow(
			"Simulated network crash",
		);

		// SyncState should have recorded backfillPage: 2 and lastError
		let state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.backfillPage).toBe(2);
		expect(state?.backfillDone).toBe(false);
		expect(state?.lastError).toContain("Simulated network crash");

		// Asset 1 from page 1 was saved
		const rowA1 = await db().immichAsset.findUnique({
			where: { immichId: a1.id },
		});
		expect(rowA1).not.toBeNull();

		// Second run: resumes from page 2
		await runScan("backfill");

		state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.backfillDone).toBe(true);
		expect(state?.lastError).toBeNull();

		const rowA2 = await db().immichAsset.findUnique({
			where: { immichId: a2.id },
		});
		expect(rowA2).not.toBeNull();
	});

	it("incremental: uses updatedAfter = cursor and advances cursor to max updatedAt seen", async () => {
		// Set backfill as already done
		await db().syncState.create({
			data: {
				id: "immich",
				backfillDone: true,
				smartDone: true,
				backfillPage: 1,
				cursor: "2026-11-14T10:00:00Z",
			},
		});

		const oldAsset = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000021",
			originalFileName: "old.png",
			updatedAt: "2026-11-14T09:00:00Z",
		});
		const newAsset1 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000022",
			originalFileName: "new1.png",
			updatedAt: "2026-11-14T11:00:00Z",
		});
		const newAsset2 = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000023",
			originalFileName: "new2.png",
			updatedAt: "2026-11-14T12:30:00Z",
		});

		fakeImmich.add(oldAsset);
		fakeImmich.add(newAsset1);
		fakeImmich.add(newAsset2);

		// Even if payload says "backfill", when backfillDone is true it runs incremental!
		await runScan("backfill");

		// oldAsset was before cursor so searchMetadata filtered it out
		const oldRow = await db().immichAsset.findUnique({
			where: { immichId: oldAsset.id },
		});
		expect(oldRow).toBeNull();

		// new assets were processed
		const newRow1 = await db().immichAsset.findUnique({
			where: { immichId: newAsset1.id },
		});
		expect(newRow1).not.toBeNull();

		const newRow2 = await db().immichAsset.findUnique({
			where: { immichId: newAsset2.id },
		});
		expect(newRow2).not.toBeNull();

		// Cursor advanced to max updatedAt (12:30:00)
		const state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.cursor).toBe("2026-11-14T12:30:00.000Z");
	});

	it("preserves decisions and does not downgrade past pending", async () => {
		const asset = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000031",
			originalFileName: "meme.png",
			originalMimeType: "image/png",
			updatedAt: "2026-11-14T10:00:00Z",
		});
		fakeImmich.add(asset);

		// Pre-populate asset as already accepted
		await db().immichAsset.create({
			data: {
				immichId: asset.id,
				checksum: asset.checksum,
				originalFileName: asset.originalFileName,
				mimeType: asset.originalMimeType,
				triageStatus: "accepted",
				decidedAt: new Date(),
			},
		});

		await runScan();

		const row = await db().immichAsset.findUnique({
			where: { immichId: asset.id },
		});
		// Status remained accepted
		expect(row?.triageStatus).toBe("accepted");
	});

	it("reads prefilter.threshold dynamically from settings", async () => {
		// Set high threshold: 0.9
		await db().setting.upsert({
			where: { key: "prefilter.threshold" },
			create: { key: "prefilter.threshold", value: 0.9 },
			update: { value: 0.9 },
		});

		// Filename + MIME = 0.30 + 0.25 = 0.55 (< 0.9)
		const asset = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000041",
			originalFileName: "screenshot_medium.png",
			originalMimeType: "image/png",
			width: 3000,
			height: 4000,
			exifInfo: { make: "Canon", model: "EOS" },
			updatedAt: "2026-11-14T10:00:00Z",
		});
		fakeImmich.add(asset);

		await runScan();

		const row = await db().immichAsset.findUnique({
			where: { immichId: asset.id },
		});
		// Score was 0.55 < 0.9 -> unscored (not pending!)
		expect(row?.prefilterScore).toBe(0.55);
		expect(row?.triageStatus).toBe("unscored");
	});

	it("incremental: an asset tying with the cursor is not skipped", async () => {
		await db().syncState.create({
			data: {
				id: "immich",
				backfillDone: true,
				smartDone: true,
				cursor: "2026-11-14T10:00:00.000Z",
			},
		});
		const tied = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000041",
			updatedAt: "2026-11-14T10:00:00.000Z",
		});
		fakeImmich.add(tied);
		await runScan();
		expect(
			await db().immichAsset.findUnique({ where: { immichId: tied.id } }),
		).not.toBeNull();
	});

	it("smart search hits without EXIF are hydrated before scoring", async () => {
		await db().setting.upsert({
			where: { key: "immich.smartQueries" },
			create: { key: "immich.smartQueries", value: ["funny"] },
			update: { value: ["funny"] },
		});
		const photo = fakeAsset({
			id: "a0000000-0000-0000-0000-000000000051",
			originalFileName: "IMG_0001.JPG",
			originalMimeType: "image/jpeg",
			width: 4000,
			height: 3000,
			exifInfo: { make: "Apple", model: "iPhone" },
			smartQueries: ["funny"],
		});
		// What smart search returned: no exifInfo at all.
		const realSearch = fakeImmich.client.searchSmart;
		fakeImmich.client.searchSmart = async (q) => {
			const page = await realSearch(q);
			return {
				...page,
				items: page.items.map(({ exifInfo: _e, ...rest }) => rest),
			};
		};
		fakeImmich.add(photo);
		await runScan();
		const row = await db().immichAsset.findUniqueOrThrow({
			where: { immichId: photo.id },
		});
		expect(row.cameraMake).toBe("Apple");
		expect(row.prefilterSignals).not.toHaveProperty("noCamera");
	});
});
