import type { AuditEventDto, Paged, UserRefDto } from "@/lib/api/types";
import { db } from "@/lib/db";

export type ListAuditOptions = {
	cursor?: string;
	action?: string;
	limit?: number;
};

/**
 * Lists audit events with prefix action matching, newest first,
 * enriched with actor details and cursor-based pagination.
 */
export async function listAuditEvents(
	options: ListAuditOptions = {},
): Promise<Paged<AuditEventDto>> {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
	const where = options.action
		? { action: { startsWith: options.action } }
		: undefined;

	const rows = await db().auditEvent.findMany({
		where,
		orderBy: [{ at: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(options.cursor
			? {
					cursor: { id: options.cursor },
					skip: 1,
				}
			: {}),
	});

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const lastItem = items[items.length - 1];
	const nextCursor = hasMore && lastItem ? lastItem.id : null;

	const actorIds = [
		...new Set(
			items
				.map((item) => item.actorId)
				.filter((id): id is string => id !== null),
		),
	];

	const userMap = new Map<string, UserRefDto>();
	if (actorIds.length > 0) {
		const users = await db().user.findMany({
			where: { id: { in: actorIds } },
			select: { id: true, email: true, username: true },
		});
		for (const u of users) {
			userMap.set(u.id, u);
		}
	}

	return {
		items: items.map((row) => ({
			id: row.id,
			actor: row.actorId ? (userMap.get(row.actorId) ?? null) : null,
			action: row.action,
			subjectType: row.subjectType,
			subjectId: row.subjectId,
			data: (row.data ?? {}) as Record<string, unknown>,
			at: row.at.toISOString(),
		})),
		nextCursor,
	};
}
