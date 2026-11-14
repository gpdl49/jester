import { beforeEach, expect, it } from "vitest";
import { GET } from "@/app/api/ai/usage/route";
import type { AiUsageDayDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";

describeWithDb("AI usage API", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("GET /api/ai/usage returns 401 without auth", async () => {
		const req = apiRequest("/api/ai/usage", { user: null });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(401);
	});

	it("groups usage across UTC midnight correctly", async () => {
		// Just before UTC midnight on 2026-11-14
		await db().aiUsage.create({
			data: {
				kind: "triage",
				model: "gemini-flash-lite",
				promptTokens: 100,
				completionTokens: 50,
				costUsd: 0.1,
				at: new Date("2026-11-14T23:55:00.000Z"),
			},
		});

		await db().aiUsage.create({
			data: {
				kind: "triage",
				model: "gemini-flash-lite",
				promptTokens: 150,
				completionTokens: 60,
				costUsd: 0.15,
				at: new Date("2026-11-14T23:58:00.000Z"),
			},
		});

		await db().aiUsage.create({
			data: {
				kind: "meme",
				model: "gemini-flash",
				promptTokens: 200,
				completionTokens: 80,
				costUsd: 0.05,
				at: new Date("2026-11-14T23:59:30.000Z"),
			},
		});

		// Just after UTC midnight on 2026-11-15
		await db().aiUsage.create({
			data: {
				kind: "triage",
				model: "gemini-flash-lite",
				promptTokens: 120,
				completionTokens: 50,
				costUsd: 0.2,
				at: new Date("2026-11-15T00:01:00.000Z"),
			},
		});

		await db().aiUsage.create({
			data: {
				kind: "attribution",
				model: "gemini-flash",
				promptTokens: 300,
				completionTokens: 100,
				costUsd: 0.3,
				at: new Date("2026-11-15T00:05:00.000Z"),
			},
		});

		// Query usage for 365 days so our specific dates are included
		const req = apiRequest("/api/ai/usage?days=365", { user: TEST_USER });
		const res = await GET(req, routeParams({}));
		expect(res.status).toBe(200);

		const items = await json<AiUsageDayDto[]>(res);

		// Find the entries for 2026-11-14
		const day14Triage = items.find(
			(i) => i.day === "2026-11-14" && i.kind === "triage",
		);
		expect(day14Triage).toBeDefined();
		expect(day14Triage?.calls).toBe(2);
		expect(day14Triage?.costUsd).toBeCloseTo(0.25, 4);

		const day14Meme = items.find(
			(i) => i.day === "2026-11-14" && i.kind === "meme",
		);
		expect(day14Meme).toBeDefined();
		expect(day14Meme?.calls).toBe(1);
		expect(day14Meme?.costUsd).toBeCloseTo(0.05, 4);

		// Find the entries for 2026-11-15
		const day15Triage = items.find(
			(i) => i.day === "2026-11-15" && i.kind === "triage",
		);
		expect(day15Triage).toBeDefined();
		expect(day15Triage?.calls).toBe(1);
		expect(day15Triage?.costUsd).toBeCloseTo(0.2, 4);

		const day15Attribution = items.find(
			(i) => i.day === "2026-11-15" && i.kind === "attribution",
		);
		expect(day15Attribution).toBeDefined();
		expect(day15Attribution?.calls).toBe(1);
		expect(day15Attribution?.costUsd).toBeCloseTo(0.3, 4);
	});
});
