import type { DashboardStatsDto } from "@/lib/api/types";
import { db } from "@/lib/db";

/**
 * Minimal cross-slice export for sync stats (owned by immich slice).
 * Reads SyncState id "immich" and counts ImmichAsset.
 */
export async function syncStats(): Promise<DashboardStatsDto["sync"]> {
	const [syncState, assetsSeen] = await Promise.all([
		db().syncState.findUnique({ where: { id: "immich" } }),
		db().immichAsset.count(),
	]);

	return {
		lastRunAt: syncState?.lastRunAt?.toISOString() ?? null,
		lastError: syncState?.lastError ?? null,
		backfillDone: syncState?.backfillDone ?? false,
		backfillPage: syncState?.backfillPage ?? 1,
		assetsSeen,
	};
}
