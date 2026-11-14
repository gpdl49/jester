import { beforeEach, expect, it, vi } from "vitest";
import { GET as getPreviewHandler } from "@/app/api/schedule/preview/route";
import {
	GET as getSlotsHandler,
	PUT as putSlotsHandler,
} from "@/app/api/schedule/slots/route";
import type { SchedulePreviewDto, ScheduleSlotDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { createPost } from "@/lib/posts/service";
import { runSchedulerTick } from "@/lib/schedule/tick";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import {
	createMeme,
	createPost as createPostRow,
} from "@/test/helpers/factories";
import { apiRequest, json, TEST_USER } from "@/test/helpers/http";
import { ADMIN_USER } from "@/test/helpers/users";

describeWithDb("schedule API and scheduler tick", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("GET and PUT /api/schedule/slots replaces slots, requires admin, and dedupes", async () => {
		// Non-admin attempt to PUT must get 403
		const nonAdminReq = apiRequest("/api/schedule/slots", {
			method: "PUT",
			body: [{ weekday: 1, time: "10:00", enabled: true }],
			user: TEST_USER,
		});
		const nonAdminRes = await putSlotsHandler(nonAdminReq, {});
		expect(nonAdminRes.status).toBe(403);

		// Admin PUT with duplicates
		const adminReq = apiRequest("/api/schedule/slots", {
			method: "PUT",
			body: [
				{ weekday: 1, time: "10:00", enabled: true },
				{ weekday: 1, time: "10:00", enabled: true }, // duplicate
				{ weekday: 3, time: "15:30", enabled: true },
			],
			user: ADMIN_USER,
		});
		const adminRes = await putSlotsHandler(adminReq, {});
		expect(adminRes.status).toBe(200);

		const slots = await json<ScheduleSlotDto[]>(adminRes);
		expect(slots).toHaveLength(2);
		expect(slots[0]?.weekday).toBe(1);
		expect(slots[0]?.time).toBe("10:00");
		expect(slots[1]?.weekday).toBe(3);
		expect(slots[1]?.time).toBe("15:30");

		// GET returns the slots
		const getReq = apiRequest("/api/schedule/slots", { user: TEST_USER });
		const getRes = await getSlotsHandler(getReq, {});
		expect(getRes.status).toBe(200);
		const readSlots = await json<ScheduleSlotDto[]>(getRes);
		expect(readSlots).toHaveLength(2);
	});

	it("GET /api/schedule/preview fills slots FIFO with unscheduled queued posts without persisting", async () => {
		// Set up 2 recurring slots: Mon 10:00, Wed 12:00
		await db().scheduleSlot.createMany({
			data: [
				{ weekday: 1, time: "10:00", enabled: true },
				{ weekday: 3, time: "12:00", enabled: true },
			],
		});

		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });

		const p1 = await createPost({ memeIds: [m1.id], status: "queued" });
		const p2 = await createPost({ memeIds: [m2.id], status: "queued" });

		// Both are unscheduled
		expect(p1.scheduledAt).toBeNull();
		expect(p2.scheduledAt).toBeNull();

		const req = apiRequest("/api/schedule/preview?days=14", {
			user: TEST_USER,
		});
		const res = await getPreviewHandler(req, {});
		expect(res.status).toBe(200);

		const preview = await json<SchedulePreviewDto>(res);
		expect(preview.length).toBeGreaterThanOrEqual(2);

		// First slot filled with p1, second slot filled with p2
		expect(preview[0]?.postId).toBe(p1.id);
		expect(preview[1]?.postId).toBe(p2.id);

		// Verify database was NOT modified (preview is non-persisting)
		const checkP1 = await db().post.findUnique({ where: { id: p1.id } });
		expect(checkP1?.scheduledAt).toBeNull();
	});

	it("runSchedulerTick assigns slots to queued posts and enqueues due posts", async () => {
		// Set recurring slot
		await db().scheduleSlot.create({
			data: { weekday: 1, time: "10:00", enabled: true },
		});

		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });

		// p1 is unscheduled queued
		const p1 = await createPost({ memeIds: [m1.id], status: "queued" });

		// p2 is already scheduled for the past (due for publishing)
		const pastTime = new Date("2026-03-01T10:00:00Z");
		const p2 = await createPost({
			memeIds: [m2.id],
			status: "queued",
			scheduledAt: pastTime,
		});

		const fixedNow = new Date("2026-03-01T12:00:00Z");
		const mockEnqueue = vi.fn().mockResolvedValue("job-id");

		const result = await runSchedulerTick(fixedNow, mockEnqueue);

		expect(result.assigned).toBe(1);
		expect(result.enqueued).toBe(1);

		// Check p1 got assigned a slot in the future
		const reloadedP1 = await db().post.findUnique({ where: { id: p1.id } });
		expect(reloadedP1?.scheduledAt).not.toBeNull();
		const scheduledTime = reloadedP1?.scheduledAt?.getTime() ?? 0;
		expect(scheduledTime).toBeGreaterThan(fixedNow.getTime());

		// Check p2 was enqueued with singletonKey: p2.id
		expect(mockEnqueue).toHaveBeenCalledWith(
			expect.objectContaining({ name: "instagram.publish" }),
			{ postId: p2.id },
			{ singletonKey: p2.id },
		);
	});

	it("runSchedulerTick is idempotent and skips when publishing.paused is true", async () => {
		// Set publishing.paused = true in settings
		await db().setting.upsert({
			where: { key: "publishing.paused" },
			create: { key: "publishing.paused", value: true },
			update: { value: true },
		});

		const m1 = await createMeme({ status: "approved" });
		await createPost({ memeIds: [m1.id], status: "queued" });

		const mockEnqueue = vi.fn();
		const result = await runSchedulerTick(new Date(), mockEnqueue);

		expect(result.paused).toBe(true);
		expect(result.assigned).toBe(0);
		expect(result.enqueued).toBe(0);
		expect(mockEnqueue).not.toHaveBeenCalled();

		// Resume publishing
		await db().setting.update({
			where: { key: "publishing.paused" },
			data: { value: false },
		});

		// Slot for tick
		await db().scheduleSlot.create({
			data: { weekday: 2, time: "14:00", enabled: true },
		});

		const now = new Date("2026-03-01T00:00:00Z");
		const run1 = await runSchedulerTick(now, mockEnqueue);
		expect(run1.assigned).toBe(1);

		// Second run on same clock should assign 0 new posts (idempotent)
		const run2 = await runSchedulerTick(now, mockEnqueue);
		expect(run2.assigned).toBe(0);
		expect(run2.enqueued).toBe(0);
	});

	it("runSchedulerTick re-enqueues a post a crashed worker left in publishing", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });
		const stuck = await createPost({ memeIds: [m1.id], status: "queued" });
		const busy = await createPost({ memeIds: [m2.id], status: "queued" });
		const now = new Date("2026-03-01T12:00:00Z");
		await db().post.update({
			where: { id: stuck.id },
			data: {
				status: "publishing",
				scheduledAt: new Date("2026-03-01T11:00:00Z"),
				updatedAt: new Date("2026-03-01T11:00:00Z"),
			},
		});
		await db().post.update({
			where: { id: busy.id },
			data: {
				status: "publishing",
				scheduledAt: new Date("2026-03-01T11:59:00Z"),
				updatedAt: new Date("2026-03-01T11:59:00Z"),
			},
		});

		const mockEnqueue = vi.fn().mockResolvedValue("job-id");
		const result = await runSchedulerTick(now, mockEnqueue);

		expect(result.enqueued).toBe(1);
		expect(mockEnqueue).toHaveBeenCalledWith(
			expect.objectContaining({ name: "instagram.publish" }),
			{ postId: stuck.id },
			{ singletonKey: stuck.id },
		);
	});

	it("runSchedulerTick does not slot a post cancelled between read and write", async () => {
		await db().scheduleSlot.create({
			data: { weekday: 2, time: "14:00", enabled: true },
		});
		const m1 = await createMeme({ status: "approved" });
		const post = await createPost({ memeIds: [m1.id], status: "queued" });
		await db().post.update({
			where: { id: post.id },
			data: { status: "cancelled" },
		});

		const result = await runSchedulerTick(
			new Date("2026-03-01T00:00:00Z"),
			vi.fn(),
		);

		expect(result.assigned).toBe(0);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } }))
				.scheduledAt,
		).toBeNull();
	});

	it("re-slots posts overdue by more than 2h but publishes recent ones", async () => {
		await db().scheduleSlot.create({
			data: { weekday: 1, time: "10:00", enabled: true },
		});
		const now = new Date("2026-11-14T12:00:00Z");
		const mk = async () => (await createMeme({ status: "approved" })).id;
		const old = await createPostRow([await mk()], {
			status: "queued",
			scheduledAt: new Date(now.getTime() - 3 * 3600 * 1000),
			queuePosition: 1,
		});
		const recent = await createPostRow([await mk()], {
			status: "queued",
			scheduledAt: new Date(now.getTime() - 30 * 60 * 1000),
			queuePosition: 2,
		});
		const enqueueFn = vi.fn().mockResolvedValue("job");

		const result = await runSchedulerTick(now, enqueueFn);

		expect(enqueueFn).toHaveBeenCalledTimes(1);
		expect(enqueueFn.mock.calls[0]?.[1]).toEqual({ postId: recent.id });
		expect(result.enqueued).toBe(1);
		const oldAfter = await db().post.findUniqueOrThrow({
			where: { id: old.id },
		});
		expect(oldAfter.status).toBe("queued");
		expect(oldAfter.queuePosition).toBe(1);
		// Back in the slot pool: assigned a future slot in the same tick.
		expect(oldAfter.scheduledAt?.getTime()).toBeGreaterThan(now.getTime());
	});
});
