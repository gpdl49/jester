// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemeDetailDto } from "@/lib/api/types";
import { mockApi, renderWithQuery, requests } from "@/test/helpers/dom";
import { MemeDetail } from "./meme-detail";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const ID = "0193290b-8d00-7000-8000-000000000001";
const meme: MemeDetailDto = {
	id: ID,
	source: "immich",
	status: "inbox",
	width: 100,
	height: 100,
	blurhash: null,
	takenAt: null,
	description: "A dog",
	template: null,
	postability: null,
	rating: null,
	tags: [
		{ name: "ai-tag", kind: "topic", source: "ai" },
		{ name: "mine", kind: "user", source: "user" },
	],
	sensitivity: null,
	hasAttribution: false,
	creditText: null,
	duplicateOfId: null,
	renditionsReady: true,
	postId: null,
	postStatus: null,
	thumbUrl: `/api/memes/${ID}/media/thumb`,
	createdAt: "2026-11-14T10:00:00.000Z",
	updatedAt: "2026-11-14T10:00:00.000Z",
	contentType: "image/png",
	size: 1,
	sha256: "x",
	ocrText: null,
	altText: null,
	language: null,
	era: null,
	captionDraft: null,
	hashtags: [],
	quality: null,
	notes: null,
	userEdited: [],
	immichId: null,
	approvedBy: null,
	approvedAt: null,
	analyses: [],
	candidates: [
		{
			id: "0193290b-8d00-7000-8000-000000000011",
			memeId: ID,
			creatorName: "Sarah Andersen",
			handle: "sarahscribbles",
			platform: "instagram",
			url: "https://www.instagram.com/p/B12345",
			evidence: "Signature in the corner",
			confidence: 0.9,
			rank: 1,
			confirmedAt: null,
			rejectedAt: null,
			createdAt: "2026-11-14T10:01:00.000Z",
		},
	],
	attribution: null,
	duplicates: [],
	posts: [],
	displayUrl: `/api/memes/${ID}/media/display`,
	originalUrl: `/api/memes/${ID}/media/original`,
};

describe("MemeDetail", () => {
	beforeEach(() => {
		mockApi({
			[`GET /api/memes/${ID}`]: meme,
			[`PATCH /api/memes/${ID}`]: meme,
			[`POST /api/memes/${ID}/attribution/${meme.candidates[0]?.id}/confirm`]:
				meme,
		});
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("renders the real attribution panel with the meme's candidates", async () => {
		renderWithQuery(<MemeDetail id={ID} />);
		expect(await screen.findByText("@sarahscribbles")).toBeInTheDocument();
		expect(screen.getByText("Signature in the corner")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Search again|Find creator/ }),
		).toBeInTheDocument();
	});

	it("leaving a field without editing it sends no PATCH", async () => {
		const fetch = mockApi({ [`GET /api/memes/${ID}`]: meme });
		renderWithQuery(<MemeDetail id={ID} />);
		const field = await screen.findByLabelText("Description");
		fireEvent.focus(field);
		fireEvent.blur(field);
		expect(requests(fetch).filter((r) => r.method === "PATCH")).toEqual([]);

		fireEvent.change(field, { target: { value: "A very good dog" } });
		fireEvent.blur(field);
		await waitFor(() =>
			expect(requests(fetch).filter((r) => r.method === "PATCH")).toHaveLength(
				1,
			),
		);
		expect(requests(fetch).find((r) => r.method === "PATCH")?.body).toEqual({
			description: "A very good dog",
		});
	});

	it("a and r hotkeys act, but Cmd/Ctrl+R (reload) never rejects the meme", async () => {
		const fetch = mockApi({
			[`GET /api/memes/${ID}`]: meme,
			[`PATCH /api/memes/${ID}`]: meme,
		});
		renderWithQuery(<MemeDetail id={ID} />);
		await screen.findByLabelText("Description");

		fireEvent.keyDown(window, { key: "r", metaKey: true });
		fireEvent.keyDown(window, { key: "r", ctrlKey: true });
		fireEvent.keyDown(window, { key: "a", ctrlKey: true });
		expect(requests(fetch).filter((r) => r.method === "PATCH")).toEqual([]);

		fireEvent.keyDown(window, { key: "r" });
		await waitFor(() =>
			expect(requests(fetch).find((r) => r.method === "PATCH")?.body).toEqual({
				status: "rejected",
			}),
		);
	});

	it("only user tags get a remove button (AI tags are not removable through PATCH)", async () => {
		renderWithQuery(<MemeDetail id={ID} />);
		await screen.findByLabelText("Description");
		expect(screen.getByLabelText("Remove tag mine")).toBeInTheDocument();
		expect(
			screen.queryByLabelText("Remove tag ai-tag"),
		).not.toBeInTheDocument();
	});
});
