import type { DashboardStatsDto } from "@/lib/api/types";
import { db } from "@/lib/db";

/**
 * Returns the sync portion of dashboard stats.
 * Called by the admin slice for GET /stats.
 */
export async function syncStats(): Promise<DashboardStatsDto["sync"]> {
	const syncState = await db().syncState.findUnique({
		where: { id: "immich" },
	});
	const assetsSeen = await db().immichAsset.count();

	return {
		lastRunAt: syncState?.lastRunAt?.toISOString() ?? null,
		lastError: syncState?.lastError ?? null,
		backfillDone: syncState?.backfillDone ?? false,
		backfillPage: syncState?.backfillPage ?? 1,
		assetsSeen,
	};
}
