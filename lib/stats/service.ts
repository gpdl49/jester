import { spentSince } from "@/lib/ai";
import type {
	DashboardStatsDto,
	MemeStatus,
	PostSummaryDto,
	TriageStatus,
} from "@/lib/api/types";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { syncStats } from "@/lib/immich/stats";
import { getSetting } from "@/lib/settings";

/**
 * Aggregates all dashboard stats: triage & meme status counts,
 * queued posts, next scheduled post, AI spend (UTC today & month),
 * sync stats, and feature toggles.
 */
export async function getDashboardStats(
	now = new Date(),
): Promise<DashboardStatsDto> {
	const triageCounts: Record<TriageStatus, number> = {
		unscored: 0,
		pending: 0,
		scored: 0,
		accepted: 0,
		rejected: 0,
		imported: 0,
		deleted: 0,
		error: 0,
	};

	const memeCounts: Record<MemeStatus, number> = {
		inbox: 0,
		approved: 0,
		rejected: 0,
		archived: 0,
	};

	const startOfToday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const startOfMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	const [
		triageGroups,
		memeGroups,
		queuedPosts,
		publishedPosts,
		nextPostRow,
		todaySpend,
		monthSpend,
		dailyBudgetUsd,
		sync,
	] = await Promise.all([
		db().immichAsset.groupBy({
			by: ["triageStatus"],
			_count: { _all: true },
		}),
		db().meme.groupBy({
			by: ["status"],
			_count: { _all: true },
		}),
		db().post.count({
			where: { status: "queued" },
		}),
		db().post.count({
			where: { status: "published" },
		}),
		db().post.findFirst({
			where: {
				status: "queued",
				scheduledAt: { not: null },
			},
			orderBy: { scheduledAt: "asc" },
			include: {
				items: {
					orderBy: { position: "asc" },
					take: 1,
					select: { memeId: true },
				},
				_count: {
					select: { items: true },
				},
			},
		}),
		spentSince(startOfToday),
		spentSince(startOfMonth),
		getSetting("ai.dailyBudgetUsd"),
		syncStats(),
	]);

	for (const g of triageGroups) {
		triageCounts[g.triageStatus] = g._count._all;
	}

	for (const g of memeGroups) {
		memeCounts[g.status] = g._count._all;
	}

	const nextPost: PostSummaryDto | null = nextPostRow
		? {
				id: nextPostRow.id,
				accountId: nextPostRow.accountId,
				kind: nextPostRow.kind,
				status: nextPostRow.status,
				caption: nextPostRow.caption,
				queuePosition: nextPostRow.queuePosition,
				scheduledAt: nextPostRow.scheduledAt?.toISOString() ?? null,
				publishedAt: nextPostRow.publishedAt?.toISOString() ?? null,
				permalink: nextPostRow.permalink,
				error: nextPostRow.error,
				thumbUrl: nextPostRow.items[0]?.memeId
					? `/api/memes/${nextPostRow.items[0].memeId}/media/thumb`
					: null,
				itemCount: nextPostRow._count.items,
				createdAt: nextPostRow.createdAt.toISOString(),
				updatedAt: nextPostRow.updatedAt.toISOString(),
			}
		: null;

	return {
		triage: triageCounts,
		memes: memeCounts,
		queuedPosts,
		publishedPosts,
		nextPost,
		aiSpend: {
			todayUsd: todaySpend,
			monthUsd: monthSpend,
			dailyBudgetUsd,
		},
		sync,
		features: features(),
	};
}
