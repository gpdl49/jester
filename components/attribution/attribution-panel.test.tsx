// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MemeDetailDto } from "@/lib/api/types";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { AttributionPanel } from "./attribution-panel";

const fakeMeme: MemeDetailDto = {
	id: "0193290b-8d00-7000-8000-000000000001",
	source: "immich",
	status: "inbox",
	width: 1080,
	height: 1080,
	blurhash: null,
	takenAt: null,
	description: "Funny dog meme",
	template: "doge",
	postability: 85,
	rating: null,
	tags: [],
	sensitivity: null,
	hasAttribution: false,
	creditText: "@doge on Instagram",
	duplicateOfId: null,
	renditionsReady: true,
	postId: null,
	postStatus: null,
	thumbUrl: "/api/memes/0193290b-8d00-7000-8000-000000000001/media/thumb",
	createdAt: "2026-11-14T10:00:00.000Z",
	updatedAt: "2026-11-14T10:00:00.000Z",
	contentType: "image/png",
	size: 12345,
	sha256: "abc123sha",
	ocrText: "Much wow, very meme",
	altText: null,
	language: "en",
	era: "2013",
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
			memeId: "0193290b-8d00-7000-8000-000000000001",
			creatorName: "Sarah Andersen",
			handle: "sarahscribbles",
			platform: "instagram",
			url: "https://www.instagram.com/p/B12345",
			evidence:
				"Matches web comic series style and art signature in bottom right",
			confidence: 0.92,
			rank: 1,
			confirmedAt: null,
			rejectedAt: null,
			createdAt: "2026-11-14T10:01:00.000Z",
		},
		{
			id: "0193290b-8d00-7000-8000-000000000012",
			memeId: "0193290b-8d00-7000-8000-000000000001",
			creatorName: null,
			handle: "random_redditor",
			platform: "reddit",
			url: "https://www.reddit.com/r/comics/comments/xyz",
			evidence: "Shared on reddit",
			confidence: 0.45,
			rank: 2,
			confirmedAt: null,
			rejectedAt: null,
			createdAt: "2026-11-14T10:01:00.000Z",
		},
	],
	attribution: null,
	duplicates: [],
	posts: [],
	displayUrl: "/api/memes/0193290b-8d00-7000-8000-000000000001/media/display",
	originalUrl: "/api/memes/0193290b-8d00-7000-8000-000000000001/media/original",
};

afterEach(cleanup);

describe("AttributionPanel", () => {
	it("renders attribution candidates with confidence, handle, evidence, and link", () => {
		mockApi({
			"GET /api/memes/0193290b-8d00-7000-8000-000000000001": fakeMeme,
		});

		renderWithQuery(<AttributionPanel meme={fakeMeme} />);

		expect(screen.getByText("@sarahscribbles")).toBeInTheDocument();
		expect(screen.getByText("(Sarah Andersen)")).toBeInTheDocument();
		expect(screen.getByText("92%")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Matches web comic series style and art signature in bottom right",
			),
		).toBeInTheDocument();

		const sourceLink = screen.getAllByRole("link", { name: /view source/i })[0];
		expect(sourceLink).toHaveAttribute(
			"href",
			"https://www.instagram.com/p/B12345",
		);
		expect(sourceLink).toHaveAttribute("target", "_blank");
		expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("triggers confirm attribution mutation on confirm button click", async () => {
		const updatedMeme: MemeDetailDto = {
			...fakeMeme,
			hasAttribution: true,
			attribution: fakeMeme.candidates[0] ?? null,
			creditText: "@sarahscribbles on Instagram",
		};

		let confirmCalled = false;
		mockApi({
			"GET /api/memes/0193290b-8d00-7000-8000-000000000001": fakeMeme,
			"POST /api/memes/0193290b-8d00-7000-8000-000000000001/attribution/0193290b-8d00-7000-8000-000000000011/confirm":
				() => {
					confirmCalled = true;
					return updatedMeme;
				},
		});

		renderWithQuery(<AttributionPanel meme={fakeMeme} />);

		const confirmBtn = screen.getByRole("button", {
			name: /confirm candidate sarahscribbles/i,
		});
		fireEvent.click(confirmBtn);

		await waitFor(() => expect(confirmCalled).toBe(true));
	});

	it("triggers reject attribution mutation on reject button click", async () => {
		let rejectCalled = false;
		mockApi({
			"GET /api/memes/0193290b-8d00-7000-8000-000000000001": fakeMeme,
			"POST /api/memes/0193290b-8d00-7000-8000-000000000001/attribution/0193290b-8d00-7000-8000-000000000012/reject":
				() => {
					rejectCalled = true;
					return fakeMeme;
				},
		});

		renderWithQuery(<AttributionPanel meme={fakeMeme} />);

		const rejectBtn = screen.getByRole("button", {
			name: /reject candidate random_redditor/i,
		});
		fireEvent.click(rejectBtn);

		await waitFor(() => expect(rejectCalled).toBe(true));
	});

	it("displays search running state when attribution analysis is active", () => {
		const memeWithRunning: MemeDetailDto = {
			...fakeMeme,
			analyses: [
				{
					id: "analysis-1",
					memeId: fakeMeme.id,
					kind: "attribution",
					model: "google/gemini-3.8-flash",
					status: "running",
					result: null,
					error: null,
					costUsd: null,
					createdAt: "2026-11-14T10:00:00Z",
					updatedAt: "2026-11-14T10:00:00Z",
				},
			],
		};

		mockApi({
			"GET /api/memes/0193290b-8d00-7000-8000-000000000001": memeWithRunning,
		});

		renderWithQuery(<AttributionPanel meme={memeWithRunning} />);

		expect(screen.getByTestId("searching-indicator")).toBeInTheDocument();
		expect(
			screen.getByText("Searching the web for the original creator"),
		).toBeInTheDocument();
	});

	it("allows editing and saving credit text", async () => {
		let updatedCredit = "";
		mockApi({
			"GET /api/memes/0193290b-8d00-7000-8000-000000000001": fakeMeme,
			"PATCH /api/memes/0193290b-8d00-7000-8000-000000000001": (
				init?: RequestInit,
			) => {
				const body = JSON.parse(String(init?.body));
				updatedCredit = body.creditText;
				return { ...fakeMeme, creditText: updatedCredit };
			},
		});

		renderWithQuery(<AttributionPanel meme={fakeMeme} />);

		const input = screen.getByRole("textbox", { name: /credit text/i });
		expect(input).toHaveValue("@doge on Instagram");

		fireEvent.change(input, { target: { value: "@newcreator on X" } });
		const saveBtn = screen.getByRole("button", { name: "Save" });
		expect(saveBtn).toBeEnabled();

		fireEvent.click(saveBtn);
		await waitFor(() => expect(updatedCredit).toBe("@newcreator on X"));
	});
});
