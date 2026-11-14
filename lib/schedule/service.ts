import type { SchedulePreviewDto, ScheduleSlotDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
	getSlotInstantsBetween,
	type ScheduleSlotInput,
} from "@/lib/schedule/slots";

export async function getScheduleSlots(): Promise<ScheduleSlotDto[]> {
	const rows = await db().scheduleSlot.findMany({
		orderBy: [{ weekday: "asc" }, { time: "asc" }],
	});

	return rows.map((r) => ({
		id: r.id,
		accountId: r.accountId,
		weekday: r.weekday,
		time: r.time,
		enabled: r.enabled,
	}));
}

export type PutScheduleSlotInput = {
	id?: string;
	accountId?: string | null;
	weekday: number;
	time: string;
	enabled?: boolean;
};

export async function updateScheduleSlots(
	slots: PutScheduleSlotInput[],
): Promise<ScheduleSlotDto[]> {
	// Deduplicate by accountId + weekday + time
	const seen = new Set<string>();
	const deduped: PutScheduleSlotInput[] = [];

	for (const slot of slots) {
		const key = `${slot.accountId ?? "null"}:${slot.weekday}:${slot.time}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(slot);
		}
	}

	return db().$transaction(async (tx) => {
		await tx.scheduleSlot.deleteMany({});

		if (deduped.length > 0) {
			await tx.scheduleSlot.createMany({
				data: deduped.map((s) => ({
					accountId: s.accountId ?? null,
					weekday: s.weekday,
					time: s.time,
					enabled: s.enabled ?? true,
				})),
			});
		}

		const rows = await tx.scheduleSlot.findMany({
			orderBy: [{ weekday: "asc" }, { time: "asc" }],
		});

		return rows.map((r) => ({
			id: r.id,
			accountId: r.accountId,
			weekday: r.weekday,
			time: r.time,
			enabled: r.enabled,
		}));
	});
}

export async function getSchedulePreview(
	days = 14,
	now = new Date(),
): Promise<SchedulePreviewDto> {
	const enabledSlots = await db().scheduleSlot.findMany({
		where: { enabled: true },
	});

	if (enabledSlots.length === 0) {
		return [];
	}

	const from = now;
	const to = new Date(now.getTime() + days * 24 * 3600 * 1000);

	const slotInputs: ScheduleSlotInput[] = enabledSlots.map((s) => ({
		id: s.id,
		accountId: s.accountId,
		weekday: s.weekday,
		time: s.time,
		enabled: s.enabled,
	}));

	const instants = getSlotInstantsBetween(
		slotInputs,
		from,
		to,
		env().SCHEDULE_TIMEZONE,
	);

	// Fetch already scheduled posts in this range
	const scheduledPosts = await db().post.findMany({
		where: {
			status: { in: ["queued", "publishing", "published"] },
			scheduledAt: { gte: from, lte: to },
		},
	});

	// Fetch unscheduled queued posts
	const unscheduledPosts = await db().post.findMany({
		where: {
			status: "queued",
			scheduledAt: null,
		},
		orderBy: [{ queuePosition: "asc" }, { createdAt: "asc" }],
	});

	// Map existing scheduled posts by exact ISO timestamp and/or slotId
	const scheduledByTime = new Map<number, string>();
	for (const p of scheduledPosts) {
		if (p.scheduledAt) {
			scheduledByTime.set(p.scheduledAt.getTime(), p.id);
		}
	}

	let unscheduledIndex = 0;
	const preview: SchedulePreviewDto = [];

	for (const instant of instants) {
		const instantTime = instant.at.getTime();
		let assignedPostId: string | null = null;

		if (scheduledByTime.has(instantTime)) {
			assignedPostId = scheduledByTime.get(instantTime) ?? null;
		} else if (unscheduledIndex < unscheduledPosts.length) {
			const nextPost = unscheduledPosts[unscheduledIndex];
			if (nextPost) {
				assignedPostId = nextPost.id;
				unscheduledIndex++;
			}
		}

		preview.push({
			at: instant.at.toISOString(),
			postId: assignedPostId,
		});
	}

	return preview;
}
