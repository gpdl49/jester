import { beforeEach, expect, it } from "vitest";
import { GET, PATCH } from "@/app/api/settings/route";
import type { SettingsDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { ADMIN_USER } from "@/test/helpers/users";

describeWithDb("settings API", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("GET /api/settings returns 401 without auth", async () => {
		const req = apiRequest("/api/settings", { user: null });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(401);
	});

	it("GET /api/settings returns settings for any authenticated user", async () => {
		const req = apiRequest("/api/settings", { user: TEST_USER });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(200);

		const data = await json<SettingsDto>(res);
		expect(data["prefilter.threshold"]).toBe(0.35);
		expect(data["caption.template"]).toContain("{caption}");
	});

	it("PATCH /api/settings returns 401 without auth", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: null,
			body: { "prefilter.threshold": 0.5 },
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(401);
	});

	it("PATCH /api/settings returns 403 for non-admin user", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: TEST_USER,
			body: { "prefilter.threshold": 0.5 },
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(403);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("forbidden");
	});

	it("PATCH /api/settings returns 400 for unknown setting key", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: ADMIN_USER,
			body: { "unknown.setting": "hello" },
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(400);
		const body = await json<{ error: string; message: string }>(res);
		expect(body.error).toBe("bad_request");
		expect(body.message).toContain("Unknown setting");
	});

	it("PATCH /api/settings returns 400 for invalid range", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: ADMIN_USER,
			body: { "prefilter.threshold": 2.5 },
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(400);
		const body = await json<{ error: string }>(res);
		expect(body.error).toBe("bad_request");
	});

	it("PATCH /api/settings returns 400 when caption.template lacks {caption}", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: ADMIN_USER,
			body: { "caption.template": "invalid template without placeholder" },
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(400);
		const body = await json<{ error: string; message: string }>(res);
		expect(body.error).toBe("bad_request");
		expect(body.message).toContain("must contain {caption}");
	});

	it("PATCH /api/settings updates settings, audits changes, and returns full settings for admin", async () => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: ADMIN_USER,
			body: {
				"prefilter.threshold": 0.42,
				"ai.dailyBudgetUsd": 5.5,
				"publishing.paused": true,
			},
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(200);

		const data = await json<SettingsDto>(res);
		expect(data["prefilter.threshold"]).toBe(0.42);
		expect(data["ai.dailyBudgetUsd"]).toBe(5.5);
		expect(data["publishing.paused"]).toBe(true);

		// Verify audit log entry
		const events = await db().auditEvent.findMany({
			where: { action: "settings.update" },
		});
		expect(events).toHaveLength(1);
		const event = events[0];
		if (!event) throw new Error("Expected event");
		const changes = (event.data as { changes: Record<string, unknown> })
			.changes;
		expect(changes).toHaveProperty("prefilter.threshold");
		expect(changes).toHaveProperty("ai.dailyBudgetUsd");
		expect(changes).toHaveProperty("publishing.paused");
	});
});

describeWithDb("settings API: prototype keys", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it.each([
		"constructor",
		"toString",
	])("PATCH rejects the inherited key %s with 400, not 500", async (key) => {
		const req = apiRequest("/api/settings", {
			method: "PATCH",
			user: ADMIN_USER,
			body: `{"${key}": 1}`,
		});
		const res = await PATCH(req, routeParams({}));
		expect(res.status).toBe(400);
		expect((await json<{ error: string }>(res)).error).toBe("bad_request");
	});
});
