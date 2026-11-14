// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardStatsDto } from "@/lib/api/types";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { DashboardView } from "./dashboard-view";

const mockStats: DashboardStatsDto = {
	triage: {
		unscored: 10,
		pending: 5,
		scored: 12,
		accepted: 8,
		rejected: 3,
		imported: 20,
		deleted: 15,
		error: 1,
	},
	memes: {
		inbox: 7,
		approved: 14,
		rejected: 2,
		archived: 25,
	},
	queuedPosts: 4,
	publishedPosts: 31,
	nextPost: {
		id: "post-123",
		accountId: null,
		kind: "image",
		status: "queued",
		caption: "A funny meme about deployment",
		queuePosition: 1,
		scheduledAt: new Date(Date.now() + 3600 * 1000).toISOString(),
		publishedAt: null,
		permalink: null,
		error: null,
		thumbUrl: "/api/memes/m-123/media/thumb",
		itemCount: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	},
	aiSpend: {
		todayUsd: 1.25,
		monthUsd: 14.5,
		dailyBudgetUsd: 3.0,
	},
	sync: {
		lastRunAt: new Date("2026-11-14T12:00:00Z").toISOString(),
		lastError: null,
		backfillDone: false,
		backfillPage: 3,
		assetsSeen: 1250,
	},
	features: {
		ai: true,
		immich: true,
		immichDelete: false,
		instagram: false,
	},
};

afterEach(cleanup);

describe("DashboardView component", () => {
	it("renders tiles, funnel, upcoming posts, spend chart and sync status", async () => {
		mockApi({
			"GET /api/stats": mockStats,
			"GET /api/ai/usage": [
				{
					day: "2026-11-14",
					kind: "triage",
					costUsd: 0.5,
					calls: 10,
				},
				{
					day: "2026-11-14",
					kind: "meme",
					costUsd: 0.75,
					calls: 5,
				},
			],
		});

		renderWithQuery(<DashboardView />);

		// Wait for data load
		await waitFor(() => {
			expect(screen.getByText("To Review")).toBeInTheDocument();
		});

		// 1. Metric tiles
		expect(screen.getByText("12")).toBeInTheDocument(); // To Review
		expect(screen.getByText("7")).toBeInTheDocument(); // Inbox
		expect(screen.getByText("14")).toBeInTheDocument(); // Approved
		expect(screen.getByText("4")).toBeInTheDocument(); // Queued
		expect(screen.getByText("Archived")).toBeInTheDocument();
		expect(screen.getByText("Published")).toBeInTheDocument();
		expect(screen.getByText("31")).toBeInTheDocument(); // Published
		expect(screen.getByText("Published").closest("a")).toHaveAttribute(
			"href",
			"/queue",
		);
		expect(screen.getByText("25")).toBeInTheDocument(); // Archived

		// 2. Feature chips
		expect(screen.getByText("AI active")).toBeInTheDocument();
		expect(screen.getByText("Immich sync active")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Immich deletion disabled (IMMICH_DELETE_ENABLED=false)",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText("Instagram: credentials not configured"),
		).toBeInTheDocument();

		// 3. Pipeline Funnel
		expect(screen.getByText("Pipeline Funnel")).toBeInTheDocument();
		expect(screen.getByText("Prefiltered")).toBeInTheDocument();
		expect(screen.getByText("Triaged")).toBeInTheDocument();
		expect(screen.getByText("Accepted")).toBeInTheDocument();
		expect(screen.getByText("Imported")).toBeInTheDocument();
		expect(screen.getByText("Deleted from Immich")).toBeInTheDocument();

		// 4. Upcoming scheduled post
		expect(screen.getByText("Scheduled Posts")).toBeInTheDocument();
		expect(
			screen.getByText("A funny meme about deployment"),
		).toBeInTheDocument();

		// 5. AI Spend & SVG chart
		expect(screen.getByText("AI Spend & Budget")).toBeInTheDocument();
		expect(screen.getByText("30-Day Spend Trend")).toBeInTheDocument();
		expect(screen.getByText("30-Day AI Spend Trend")).toBeInTheDocument();

		// 6. Sync status
		expect(screen.getByText("Immich Sync Status")).toBeInTheDocument();
		expect(screen.getByText("Page 3")).toBeInTheDocument();
		expect(screen.getAllByText("1,250")).toHaveLength(2);
		expect(screen.getByText("Healthy")).toBeInTheDocument();
	});

	it("lists the soonest scheduled queued posts, skipping unscheduled ones that sort first", async () => {
		const post = (id: string, caption: string, scheduledAt: string | null) => ({
			...(mockStats.nextPost as NonNullable<DashboardStatsDto["nextPost"]>),
			id,
			caption,
			scheduledAt,
		});
		mockApi({
			"GET /api/stats": mockStats,
			"GET /api/ai/usage": [],
			// API order is queue position: unscheduled first, then by creation.
			"GET /api/posts": {
				items: [
					post("p0", "unscheduled one", null),
					post("p1", "later post", "2030-01-03T10:00:00.000Z"),
					post("p2", "soonest post", "2030-01-01T10:00:00.000Z"),
					post("p3", "middle post", "2030-01-02T10:00:00.000Z"),
					post("p4", "latest post", "2030-01-04T10:00:00.000Z"),
				],
				nextCursor: null,
			},
		});
		renderWithQuery(<DashboardView />);
		await waitFor(() =>
			expect(screen.getByText("soonest post")).toBeInTheDocument(),
		);
		expect(screen.queryByText("unscheduled one")).not.toBeInTheDocument();
		expect(screen.queryByText("latest post")).not.toBeInTheDocument();
		expect(screen.getByText("middle post")).toBeInTheDocument();
		expect(screen.getByText("later post")).toBeInTheDocument();
		const [first, second, third] = [
			"soonest post",
			"middle post",
			"later post",
		].map((t) => screen.getByText(t)) as [
			HTMLElement,
			HTMLElement,
			HTMLElement,
		];
		expect(
			first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("shows a zero daily budget as 0.00 and fully used, not as the default 3", async () => {
		mockApi({
			"GET /api/stats": {
				...mockStats,
				aiSpend: { todayUsd: 0, monthUsd: 0, dailyBudgetUsd: 0 },
			},
			"GET /api/ai/usage": [],
		});
		renderWithQuery(<DashboardView />);
		await waitFor(() =>
			expect(screen.getByText("Today: $0.0000 of $0.00")).toBeInTheDocument(),
		);
	});
});
