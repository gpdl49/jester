import { beforeEach, expect, it } from "vitest";
import { GET } from "@/app/api/stats/route";
import type { DashboardStatsDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import {
	createImmichAsset,
	createMeme,
	createPost,
} from "@/test/helpers/factories";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";

describeWithDb("stats API", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("GET /api/stats returns 401 without auth", async () => {
		const req = apiRequest("/api/stats", { user: null });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(401);
	});

	it("GET /api/stats aggregates triage, memes, posts, AI spend, and sync stats", async () => {
		// 1. Seed ImmichAssets
		await createImmichAsset({ triageStatus: "scored" });
		await createImmichAsset({ triageStatus: "scored" });
		await createImmichAsset({ triageStatus: "pending" });
		await createImmichAsset({ triageStatus: "deleted" });

		// 2. Seed Memes
		const m1 = await createMeme({ status: "inbox" });
		const m2 = await createMeme({ status: "approved" });
		await createMeme({ status: "archived" });

		// 3. Seed Posts
		// draft post (should not count as queued)
		await createPost([m1.id], { status: "draft" });
		await createPost([m1.id], { status: "published" });
		// queued post 1 (scheduled in 2 hours)
		await createPost([m2.id], {
			status: "queued",
			scheduledAt: new Date(Date.now() + 2 * 3600 * 1000),
		});
		// queued post 2 (scheduled in 1 hour - earlier!)
		const post1h = await createPost([m1.id], {
			status: "queued",
			scheduledAt: new Date(Date.now() + 1 * 3600 * 1000),
		});

		// 4. Seed SyncState
		await db().syncState.upsert({
			where: { id: "immich" },
			create: {
				id: "immich",
				backfillPage: 5,
				backfillDone: false,
				lastRunAt: new Date("2026-11-14T10:00:00Z"),
				lastError: null,
			},
			update: {},
		});

		// 5. Seed AI Usage
		const now = new Date();
		// Today
		await db().aiUsage.create({
			data: {
				kind: "triage",
				model: "gemini",
				costUsd: 0.25,
				at: now,
			},
		});
		await db().aiUsage.create({
			data: {
				kind: "meme",
				model: "gemini",
				costUsd: 0.15,
				at: now,
			},
		});

		const req = apiRequest("/api/stats", { user: TEST_USER });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(200);

		const data = await json<DashboardStatsDto>(res);

		// Triage counts
		expect(data.triage.scored).toBe(2);
		expect(data.triage.pending).toBe(1);
		expect(data.triage.deleted).toBe(1);
		expect(data.triage.accepted).toBe(0);

		// Meme counts
		expect(data.memes.inbox).toBe(1);
		expect(data.memes.approved).toBe(1);
		expect(data.memes.archived).toBe(1);
		expect(data.memes.rejected).toBe(0);

		// Queued posts
		expect(data.queuedPosts).toBe(2);
		expect(data.publishedPosts).toBe(1);

		// Next scheduled post (post1h should be next because scheduledAt is earlier)
		expect(data.nextPost).not.toBeNull();
		expect(data.nextPost?.id).toBe(post1h.id);
		expect(data.nextPost?.thumbUrl).toBe(`/api/memes/${m1.id}/media/thumb`);
		expect(data.nextPost?.itemCount).toBe(1);

		// AI spend
		expect(data.aiSpend.todayUsd).toBeCloseTo(0.4, 4);
		expect(data.aiSpend.monthUsd).toBeCloseTo(0.4, 4);
		expect(data.aiSpend.dailyBudgetUsd).toBeGreaterThanOrEqual(0);

		// Sync stats
		expect(data.sync.backfillPage).toBe(5);
		expect(data.sync.backfillDone).toBe(false);
		expect(data.sync.assetsSeen).toBe(4);
		expect(data.sync.lastRunAt).toBe("2026-11-14T10:00:00.000Z");

		// Features
		expect(data.features).toHaveProperty("ai");
		expect(data.features).toHaveProperty("immich");
		expect(data.features).toHaveProperty("instagram");
	});
});
