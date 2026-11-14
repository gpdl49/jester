import { beforeEach, expect, it } from "vitest";
import { GET } from "@/app/api/audit/route";
import type { AuditEventDto, Paged } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { ADMIN_USER, userId } from "@/test/helpers/users";

describeWithDb("audit API", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("GET /api/audit returns 401 without auth", async () => {
		const req = apiRequest("/api/audit", { user: null });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(401);
	});

	it("GET /api/audit filters by action prefix and returns actor details", async () => {
		const adminId = await userId(ADMIN_USER);
		const testId = await userId(TEST_USER);

		await audit({
			actorId: adminId,
			action: "settings.update",
			subjectType: "setting",
			data: { key: "prefilter.threshold" },
		});

		await audit({
			actorId: testId,
			action: "triage.accept",
			subjectType: "immich_asset",
			subjectId: "asset-123",
		});

		await audit({
			actorId: null, // System event
			action: "immich.delete",
			subjectType: "immich_asset",
			subjectId: "asset-456",
			data: { status: "done" },
		});

		// 1. Query with action=settings
		const reqSettings = apiRequest("/api/audit?action=settings", {
			user: TEST_USER,
		});
		const resSettings = await GET(reqSettings, routeParams({}));
		expect(resSettings.status).toBe(200);

		const dataSettings = await json<Paged<AuditEventDto>>(resSettings);
		expect(dataSettings.items).toHaveLength(1);
		const item0 = dataSettings.items[0];
		if (!item0) throw new Error("Expected item");
		expect(item0.action).toBe("settings.update");
		expect(item0.actor?.username).toBe(ADMIN_USER.username);

		// 2. Query with action=immich
		const reqImmich = apiRequest("/api/audit?action=immich", {
			user: TEST_USER,
		});
		const resImmich = await GET(reqImmich, routeParams({}));
		const dataImmich = await json<Paged<AuditEventDto>>(resImmich);
		expect(dataImmich.items).toHaveLength(1);
		const immichItem = dataImmich.items[0];
		if (!immichItem) throw new Error("Expected item");
		expect(immichItem.action).toBe("immich.delete");
		expect(immichItem.actor).toBeNull();
	});

	it("GET /api/audit supports cursor pagination and newest-first order", async () => {
		const testId = await userId(TEST_USER);

		// Create 5 events with slight time differences
		for (let i = 1; i <= 5; i++) {
			await audit({
				actorId: testId,
				action: `test.event_${i}`,
				subjectType: "test",
				data: { index: i },
			});
			// small delay to ensure strictly distinct timestamps
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		// First page: limit 2
		const req1 = apiRequest("/api/audit?limit=2", { user: TEST_USER });
		const res1 = await GET(req1, routeParams({}));
		expect(res1.status).toBe(200);

		const page1 = await json<Paged<AuditEventDto>>(res1);
		expect(page1.items).toHaveLength(2);
		expect(page1.items[0]?.action).toBe("test.event_5"); // newest first
		expect(page1.items[1]?.action).toBe("test.event_4");
		expect(page1.nextCursor).not.toBeNull();

		// Second page: use nextCursor
		const req2 = apiRequest(`/api/audit?limit=2&cursor=${page1.nextCursor}`, {
			user: TEST_USER,
		});
		const res2 = await GET(req2, routeParams({}));
		const page2 = await json<Paged<AuditEventDto>>(res2);
		expect(page2.items).toHaveLength(2);
		expect(page2.items[0]?.action).toBe("test.event_3");
		expect(page2.items[1]?.action).toBe("test.event_2");
		expect(page2.nextCursor).not.toBeNull();

		// Third page: last item
		const req3 = apiRequest(`/api/audit?limit=2&cursor=${page2.nextCursor}`, {
			user: TEST_USER,
		});
		const res3 = await GET(req3, routeParams({}));
		const page3 = await json<Paged<AuditEventDto>>(res3);
		expect(page3.items).toHaveLength(1);
		expect(page3.items[0]?.action).toBe("test.event_1");
		expect(page3.nextCursor).toBeNull();
	});

	it("GET /api/audit rejects a malformed cursor with 400", async () => {
		const res = await GET(
			apiRequest("/api/audit?cursor=not-a-uuid", { user: TEST_USER }),
			routeParams({}),
		);
		expect(res.status).toBe(400);
	});

	it("GET /api/audit pages through events with identical timestamps without gaps or repeats", async () => {
		const at = new Date("2026-11-01T00:00:00.000Z");
		await db().auditEvent.createMany({
			data: Array.from({ length: 5 }, (_, i) => ({
				action: `same.${i}`,
				subjectType: "test",
				data: {},
				at,
			})),
		});
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let guard = 0; guard < 5; guard++) {
			const res = await GET(
				apiRequest(
					`/api/audit?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
					{ user: TEST_USER },
				),
				routeParams({}),
			);
			const page: Paged<AuditEventDto> = await json(res);
			seen.push(...page.items.map((e) => e.action));
			cursor = page.nextCursor;
			if (!cursor) break;
		}
		expect(seen.sort()).toEqual([0, 1, 2, 3, 4].map((i) => `same.${i}`));
	});
});
