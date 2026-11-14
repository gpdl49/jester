import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { instagramPublish } from "@/lib/jobs/definitions/instagram-publish";
import { enqueue } from "@/lib/jobs/queue";
import { getNextSlotInstants } from "@/lib/schedule/slots";
import { getSetting } from "@/lib/settings";

export type SchedulerTickResult = {
	assigned: number;
	enqueued: number;
	paused: boolean;
};

/**
 * Executes a single scheduler tick:
 * 1. Checks if publishing is paused (`publishing.paused` setting). If paused, skips both steps.
 * 2. Assigns `scheduledAt` and `slotId` to queued posts without one (FIFO by queuePosition asc nulls last, then createdAt),
 *    to the earliest future slots not already taken by a scheduled post (one post per slot).
 * 3. For queued posts with `scheduledAt <= now`, enqueues `instagram.publish` with `singletonKey: postId`.
 *
 * Idempotent.
 */
export async function runSchedulerTick(
	now: Date = new Date(),
	enqueueFn = enqueue,
): Promise<SchedulerTickResult> {
	let paused = false;
	try {
		paused = await getSetting("publishing.paused");
	} catch {
		// Default to false if settings table is empty
		paused = false;
	}

	if (paused) {
		return { assigned: 0, enqueued: 0, paused: true };
	}

	// (a) Slot assignment
	let assignedCount = 0;
	const unscheduled = await db().post.findMany({
		where: {
			status: "queued",
			scheduledAt: null,
		},
		orderBy: [{ queuePosition: "asc" }, { createdAt: "asc" }],
	});

	if (unscheduled.length > 0) {
		const slots = await db().scheduleSlot.findMany({
			where: { enabled: true },
		});

		if (slots.length > 0) {
			// Find future posts that already have a scheduledAt > now
			const futurePosts = await db().post.findMany({
				where: {
					status: { in: ["queued", "publishing", "published"] },
					scheduledAt: { gt: now },
				},
				select: { scheduledAt: true, slotId: true },
			});

			const takenTimes = new Set(
				futurePosts
					.map((p) => p.scheduledAt?.getTime())
					.filter((t): t is number => typeof t === "number"),
			);

			// Generate future slot instants starting after `now`
			const neededSlots = Math.max(unscheduled.length * 3, 50);
			const instants = getNextSlotInstants(
				slots,
				now,
				neededSlots,
				env().SCHEDULE_TIMEZONE,
			);

			const availableInstants = instants.filter(
				(i) => !takenTimes.has(i.at.getTime()),
			);

			for (const post of unscheduled) {
				const nextInstant = availableInstants.shift();
				if (!nextInstant) {
					// Ran out of available slots within generated window
					break;
				}

				takenTimes.add(nextInstant.at.getTime());
				await db().post.update({
					where: { id: post.id },
					data: {
						scheduledAt: nextInstant.at,
						slotId: nextInstant.slot.id ?? null,
					},
				});
				assignedCount++;
			}
		}
	}

	// (b) Enqueue due posts
	let enqueuedCount = 0;
	const duePosts = await db().post.findMany({
		where: {
			status: "queued",
			scheduledAt: { lte: now },
		},
		orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
	});

	for (const post of duePosts) {
		await enqueueFn(
			instagramPublish,
			{ postId: post.id },
			{ singletonKey: post.id },
		);
		enqueuedCount++;
	}

	return {
		assigned: assignedCount,
		enqueued: enqueuedCount,
		paused: false,
	};
}
