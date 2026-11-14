// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriageCandidateDto } from "@/lib/api/types";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { TriageView } from "./triage-view";

const candidate1: TriageCandidateDto = {
	id: "01932cf3-4c91-7f99-a991-884c78491bb1",
	immichId: "01932cf3-4c91-7f99-a991-884c78491cc1",
	originalFileName: "funny_cat.png",
	mimeType: "image/png",
	width: 1080,
	height: 1080,
	fileCreatedAt: "2024-01-01T12:00:00Z",
	prefilterScore: 0.8,
	prefilterSignals: { mime: true },
	smartHits: ["meme"],
	triageStatus: "scored",
	memeProbability: 0.95,
	triageResult: {
		memeProbability: 0.95,
		kind: "meme",
		reason: "Classic funny cat meme",
	},
	memeId: null,
	error: null,
	previewUrl: "/api/triage/01932cf3-4c91-7f99-a991-884c78491bb1/preview",
};

const candidate2: TriageCandidateDto = {
	id: "01932cf3-4c91-7f99-a991-884c78491bb2",
	immichId: "01932cf3-4c91-7f99-a991-884c78491cc2",
	originalFileName: "screenshot_chat.png",
	mimeType: "image/png",
	width: 1080,
	height: 1920,
	fileCreatedAt: "2024-01-02T12:00:00Z",
	prefilterScore: 0.4,
	prefilterSignals: { screenDims: true },
	smartHits: [],
	triageStatus: "scored",
	memeProbability: 0.15,
	triageResult: {
		memeProbability: 0.15,
		kind: "chat_screenshot",
		reason: "Ordinary WhatsApp conversation",
	},
	memeId: null,
	error: null,
	previewUrl: "/api/triage/01932cf3-4c91-7f99-a991-884c78491bb2/preview",
};

const candidate3: TriageCandidateDto = {
	id: "01932cf3-4c91-7f99-a991-884c78491bb3",
	immichId: "01932cf3-4c91-7f99-a991-884c78491cc3",
	originalFileName: "webcomic.png",
	mimeType: "image/png",
	width: 1200,
	height: 800,
	fileCreatedAt: "2024-01-03T12:00:00Z",
	prefilterScore: 0.7,
	prefilterSignals: { mime: true },
	smartHits: ["comic"],
	triageStatus: "scored",
	memeProbability: 0.88,
	triageResult: {
		memeProbability: 0.88,
		kind: "comic",
		reason: "Short 4-panel webcomic",
	},
	memeId: null,
	error: null,
	previewUrl: "/api/triage/01932cf3-4c91-7f99-a991-884c78491bb3/preview",
};

beforeEach(() => {
	class MockIntersectionObserver {
		observe = vi.fn();
		unobserve = vi.fn();
		disconnect = vi.fn();
	}
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

	class MockResizeObserver {
		observe = vi.fn();
		unobserve = vi.fn();
		disconnect = vi.fn();
	}
	vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("TriageView component", () => {
	it("renders candidates with preview, filename, and probability badge", async () => {
		mockApi({
			"GET /api/triage": {
				items: [candidate1, candidate2],
				nextCursor: null,
			},
		});

		renderWithQuery(<TriageView isAdmin={false} />);

		expect(await screen.findByText("funny_cat.png")).toBeInTheDocument();
		expect(screen.getByText("screenshot_chat.png")).toBeInTheDocument();
		expect(screen.getByText("95%")).toBeInTheDocument();
		expect(screen.getByText("15%")).toBeInTheDocument();
		expect(
			screen.getByText("[meme] Classic funny cat meme"),
		).toBeInTheDocument();
	});

	it("handles keyboard navigation (j/k) and selection (x)", async () => {
		mockApi({
			"GET /api/triage": {
				items: [candidate1, candidate2, candidate3],
				nextCursor: null,
			},
		});

		renderWithQuery(<TriageView isAdmin={false} />);

		await screen.findByText("funny_cat.png");

		const card1 = screen.getByTestId(`triage-card-${candidate1.id}`);
		const card2 = screen.getByTestId(`triage-card-${candidate2.id}`);

		// Initially first item has focus ring
		expect(card1.className).toContain("ring-2");
		expect(card2.className).not.toContain("ring-2");

		// Press j to move to next
		act(() => {
			fireEvent.keyDown(window, { key: "j" });
		});

		expect(card1.className).not.toContain("ring-2");
		expect(card2.className).toContain("ring-2");

		// Press k to move back
		act(() => {
			fireEvent.keyDown(window, { key: "k" });
		});

		expect(card1.className).toContain("ring-2");

		// Press x to toggle selection on card 1
		act(() => {
			fireEvent.keyDown(window, { key: "x" });
		});

		expect(card1.className).toContain("border-accent");
		expect(screen.getByText("1 selected")).toBeInTheDocument();
	});

	it("performs optimistic removal with 5s undo window", async () => {
		vi.useFakeTimers();
		const api = mockApi({
			"GET /api/triage": {
				items: [candidate1, candidate2],
				nextCursor: null,
			},
			"POST /api/triage/decisions": {
				accepted: 1,
				rejected: 0,
			},
		});

		renderWithQuery(<TriageView isAdmin={false} />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});

		expect(screen.getByText("funny_cat.png")).toBeInTheDocument();

		// Press 'a' to accept first item
		act(() => {
			fireEvent.keyDown(window, { key: "a" });
		});

		// Optimistically removed from view
		expect(screen.queryByText("funny_cat.png")).not.toBeInTheDocument();

		// Undo banner visible
		expect(screen.getByText("Decided 1 candidate")).toBeInTheDocument();

		// Click Undo
		const undoBtn = screen.getByRole("button", { name: /undo/i });
		act(() => {
			fireEvent.click(undoBtn);
		});

		// Restored
		expect(screen.getByText("funny_cat.png")).toBeInTheDocument();
		expect(screen.queryByText("Decided 1 candidate")).not.toBeInTheDocument();

		// Verify no decision POST was sent yet
		const postCalls = api.mock.calls.filter(
			([, init]) => init?.method === "POST",
		);
		expect(postCalls).toHaveLength(0);

		// Even after the undo window would have elapsed, nothing is sent.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(
			api.mock.calls.filter(([, init]) => init?.method === "POST"),
		).toHaveLength(0);

		vi.useRealTimers();
	});

	it("sends exactly one decisions POST after the undo window", async () => {
		vi.useFakeTimers();
		const api = mockApi({
			"GET /api/triage": { items: [candidate1, candidate2], nextCursor: null },
			"POST /api/triage/decisions": { accepted: 1, rejected: 0 },
		});
		renderWithQuery(<TriageView isAdmin={false} />);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		act(() => {
			fireEvent.keyDown(window, { key: "a" });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5100);
		});
		const posts = api.mock.calls.filter(([, init]) => init?.method === "POST");
		expect(posts).toHaveLength(1);
		expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
			decisions: [{ immichAssetId: candidate1.id, decision: "accept" }],
		});
		vi.useRealTimers();
	});

	it("selects a range with shift-click", async () => {
		mockApi({
			"GET /api/triage": {
				items: [candidate1, candidate2, candidate3],
				nextCursor: null,
			},
		});

		renderWithQuery(<TriageView isAdmin={false} />);

		await screen.findByText("funny_cat.png");

		const card1 = screen.getByTestId(`triage-card-${candidate1.id}`);
		const card3 = screen.getByTestId(`triage-card-${candidate3.id}`);

		// Select card 1 via its checkbox button
		const checkBtn1 = card1.querySelector("button");
		expect(checkBtn1).not.toBeNull();
		if (checkBtn1) {
			fireEvent.click(checkBtn1);
		}

		// Shift-click card 3
		fireEvent.click(card3, { shiftKey: true });

		expect(screen.getByText("3 selected")).toBeInTheDocument();
	});

	it("renders admin accept-all slider and opens confirmation dialog", async () => {
		mockApi({
			"GET /api/triage": {
				items: [candidate1, candidate2],
				nextCursor: null,
			},
			"POST /api/triage/accept-above": {
				accepted: 1,
			},
		});

		renderWithQuery(<TriageView isAdmin={true} />);

		await screen.findByText("funny_cat.png");

		// Slider button should be present
		const acceptAllBtn = screen.getByRole("button", {
			name: /accept all ≥ 80%/i,
		});
		expect(acceptAllBtn).toBeInTheDocument();

		// Click opens confirm dialog
		fireEvent.click(acceptAllBtn);

		expect(
			screen.getByText(/accept all candidates with score ≥ 80%/i),
		).toBeInTheDocument();
	});
});
