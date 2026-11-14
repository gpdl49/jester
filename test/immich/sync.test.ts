import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import type { MetadataSearchWithTaken } from "@/lib/immich/client";
import { runScan } from "@/lib/immich/sync";
import { stopBoss } from "@/lib/jobs/queue";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
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
		// Incremental cursor starts 5 minutes before the backfill began.
		expect(syncState?.backfillStartedAt).not.toBeNull();
		expect(new Date(syncState?.cursor ?? "").getTime()).toBe(
			(syncState?.backfillStartedAt?.getTime() ?? 0) - 5 * 60 * 1000,
		);
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

	/** Makes the fake serve 2 assets per page, so paging is actually exercised. */
	function smallPages() {
		const real = fakeImmich.client.searchMetadata.bind(fakeImmich.client);
		const queries: MetadataSearchWithTaken[] = [];
		fakeImmich.client.searchMetadata = async (q) => {
			queries.push(q);
			return real({ ...q, size: 2 });
		};
		return queries;
	}

	const timed = (n: number, fileCreatedAt: string) =>
		fakeAsset({
			id: `a0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`,
			originalFileName: `a${n}.png`,
			fileCreatedAt,
			updatedAt: fileCreatedAt,
		});

	it("backfill: resumes from SyncState.backfillCursor after a crash", async () => {
		const a1 = timed(1, "2026-11-14T01:00:00.000Z");
		const a2 = timed(2, "2026-11-14T02:00:00.000Z");
		const a3 = timed(3, "2026-11-14T03:00:00.000Z");
		const a4 = timed(4, "2026-11-14T04:00:00.000Z");
		const a5 = timed(5, "2026-11-14T05:00:00.000Z");
		for (const a of [a1, a2, a3, a4, a5]) fakeImmich.add(a);
		const queries = smallPages();

		// Crash on the third metadata request (after two pages: a1..a3 processed).
		const read = fakeImmich.client.searchMetadata;
		let calls = 0;
		fakeImmich.client.searchMetadata = async (q) => {
			if (++calls === 3) throw new Error("Simulated network crash");
			return read(q);
		};

		await expect(runScan("backfill")).rejects.toThrow(
			"Simulated network crash",
		);

		let state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.backfillDone).toBe(false);
		expect(state?.backfillCursor).toBe("2026-11-14T03:00:00.000Z");
		expect(state?.backfillPage).toBe(3); // progress counter: pages read + 1
		expect(state?.lastError).toContain("Simulated network crash");
		expect(await db().immichAsset.count()).toBe(3);

		// Second run resumes at the cursor (minus 1 ms), not at an index.
		queries.length = 0;
		fakeImmich.client.searchMetadata = read;
		await runScan("backfill");

		expect(queries[0]).toMatchObject({
			page: 1,
			takenAfter: "2026-11-14T02:59:59.999Z",
		});
		state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.backfillDone).toBe(true);
		expect(state?.lastError).toBeNull();
		expect(
			await db().immichAsset.findUnique({ where: { immichId: a5.id } }),
		).not.toBeNull();
	});

	it("backfill: an asset removed before the current page does not make it skip another", async () => {
		const assets = [
			timed(1, "2026-11-14T01:00:00.000Z"),
			timed(2, "2026-11-14T02:00:00.000Z"),
			timed(3, "2026-11-14T03:00:00.000Z"),
			timed(4, "2026-11-14T04:00:00.000Z"),
			timed(5, "2026-11-14T05:00:00.000Z"),
		];
		for (const a of assets) fakeImmich.add(a);
		smallPages();

		// Like immich.delete removing an already-imported asset mid-backfill:
		// after each page is served, the oldest remaining asset disappears.
		const read = fakeImmich.client.searchMetadata;
		let served = 0;
		fakeImmich.client.searchMetadata = async (q) => {
			const result = await read(q);
			const gone = assets[served++];
			if (gone) fakeImmich.assets.delete(gone.id);
			return result;
		};

		await runScan("backfill");

		const immichIds = (await db().immichAsset.findMany()).map(
			(a) => a.immichId,
		);
		expect(immichIds.sort()).toEqual(assets.map((a) => a.id).sort());
	});

	it("backfill: a full page of assets with the same timestamp still terminates and reads all of them", async () => {
		const same = "2026-11-14T05:00:00.000Z";
		const assets = [timed(1, same), timed(2, same), timed(3, same)];
		for (const a of assets) fakeImmich.add(a);
		const real = fakeImmich.client.searchMetadata.bind(fakeImmich.client);
		fakeImmich.client.searchMetadata = (q) => real({ ...q, size: 2 });

		await runScan("backfill");

		expect(await db().immichAsset.count()).toBe(3);
		const state = await db().syncState.findUnique({ where: { id: "immich" } });
		expect(state?.backfillDone).toBe(true);
	});

	describe("stuck accepted sweep", () => {
		const queuedImports = (assetId: string) =>
			db().$queryRaw<{ id: string }[]>`
				SELECT id FROM pgboss.job
				WHERE name = 'import.immich' AND data->>'immichAssetId' = ${assetId}`;
		const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

		it("re-enqueues import.immich once for assets accepted over 30 minutes ago without a meme", async () => {
			const stuck = await createImmichAsset({
				triageStatus: "accepted",
				decidedAt: minutesAgo(31),
			});
			const recent = await createImmichAsset({
				triageStatus: "accepted",
				decidedAt: minutesAgo(5),
			});
			const meme = await createMeme();
			const linked = await createImmichAsset({
				triageStatus: "accepted",
				decidedAt: minutesAgo(90),
				memeId: meme.id,
			});
			const scored = await createImmichAsset({
				triageStatus: "scored",
				decidedAt: minutesAgo(90),
			});

			await runScan();
			await runScan(); // repeats must not pile up

			expect(await queuedImports(stuck.id)).toHaveLength(1);
			expect(await queuedImports(recent.id)).toHaveLength(0);
			expect(await queuedImports(linked.id)).toHaveLength(0);
			expect(await queuedImports(scored.id)).toHaveLength(0);
		});
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
