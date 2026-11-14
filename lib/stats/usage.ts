import type { AiUsageDayDto } from "@/lib/api/types";
import { db } from "@/lib/db";

/**
 * Returns AI spend grouped by UTC day (YYYY-MM-DD) and kind for the last N days.
 */
export async function getAiUsageByDay(
	days = 30,
	now = new Date(),
): Promise<AiUsageDayDto[]> {
	const clampedDays = Math.min(Math.max(days, 1), 365);
	const startOfToday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const since = new Date(
		startOfToday.getTime() - (clampedDays - 1) * 24 * 60 * 60 * 1000,
	);

	const rows = await db().$queryRaw<
		Array<{ day: string; kind: string; costUsd: number; calls: number }>
	>`
		SELECT
			to_char("at", 'YYYY-MM-DD') AS day,
			kind,
			COALESCE(SUM(cost_usd), 0)::float AS "costUsd",
			COUNT(*)::int AS calls
		FROM ai_usage
		WHERE "at" >= ${since}
		GROUP BY 1, 2
		ORDER BY 1 ASC, 2 ASC
	`;

	return rows.map((r) => ({
		day: r.day,
		kind: r.kind,
		costUsd: Number(r.costUsd),
		calls: Number(r.calls),
	}));
}
