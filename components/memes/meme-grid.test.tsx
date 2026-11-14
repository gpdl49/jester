// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemeSummaryDto, Paged } from "@/lib/api/types";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { MemeGrid } from "./meme-grid";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/memes",
	useSearchParams: () => new URLSearchParams(),
}));

const mockMemes: MemeSummaryDto[] = [
	{
		id: "m1",
		source: "immich",
		status: "inbox",
		width: 800,
		height: 600,
		blurhash: null,
		takenAt: "2026-11-14T10:00:00Z",
		description: "Meme One",
		template: "drake",
		postability: 88,
		rating: 4,
		tags: [{ name: "cat", kind: "topic", source: "ai" }],
		sensitivity: {
			nsfw: false,
			politics: false,
			slurs: false,
			personalData: false,
			notes: null,
		},
		hasAttribution: true,
		creditText: "Credit Cat",
		duplicateOfId: null,
		renditionsReady: true,
		postId: null,
		postStatus: null,
		thumbUrl: "/api/memes/m1/media/thumb",
		createdAt: "2026-11-14T10:00:00Z",
		updatedAt: "2026-11-14T10:00:00Z",
	},
	{
		id: "m2",
		source: "upload",
		status: "approved",
		width: 800,
		height: 600,
		blurhash: null,
		takenAt: "2026-11-14T11:00:00Z",
		description: "Meme Two",
		template: "doge",
		postability: 45,
		rating: null,
		tags: [{ name: "dog", kind: "topic", source: "user" }],
		sensitivity: {
			nsfw: true,
			politics: false,
			slurs: false,
			personalData: false,
			notes: "Spicy",
		},
		hasAttribution: false,
		creditText: null,
		duplicateOfId: null,
		renditionsReady: true,
		postId: "p1",
		postStatus: "queued",
		thumbUrl: "/api/memes/m2/media/thumb",
		createdAt: "2026-11-14T11:00:00Z",
		updatedAt: "2026-11-14T11:00:00Z",
	},
];

describe("MemeGrid & Selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApi({
			"GET /api/memes": {
				items: mockMemes,
				nextCursor: null,
			} satisfies Paged<MemeSummaryDto>,
			"GET /api/tags": [],
		});
	});

	it("renders meme cards with postability, sensitivity, and attribution badges", async () => {
		renderWithQuery(<MemeGrid />);

		// Wait for memes to load
		expect(await screen.findByText("88")).toBeInTheDocument();
		expect(screen.getByText("45")).toBeInTheDocument();

		// Attribution badge on m1
		expect(screen.getByTitle("Attribution confirmed")).toBeInTheDocument();

		// Sensitivity badge on m2
		expect(screen.getByTitle("Sensitive content: NSFW")).toBeInTheDocument();

		// Status chips
		expect(screen.getByText("inbox")).toBeInTheDocument();
		expect(screen.getByText("approved")).toBeInTheDocument();
		expect(screen.getByText("Post: queued")).toBeInTheDocument();
	});

	it("multi-selects cards and shows bulk action bar", async () => {
		renderWithQuery(<MemeGrid />);

		expect(await screen.findByText("88")).toBeInTheDocument();

		// Initially bulk bar is not visible
		expect(screen.queryByText("selected")).not.toBeInTheDocument();

		// Click checkbox on m1
		const checkbox1 = screen.getByLabelText("Select meme m1");
		fireEvent.click(checkbox1);

		// Bulk bar shows 1 selected
		expect(await screen.findByText("1")).toBeInTheDocument();
		expect(screen.getByText("selected")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

		// Click checkbox on m2
		const checkbox2 = screen.getByLabelText("Select meme m2");
		fireEvent.click(checkbox2);

		expect(screen.getByText("2")).toBeInTheDocument();

		// Clear selection
		const clearBtn = screen.getByRole("button", { name: "Clear" });
		fireEvent.click(clearBtn);

		expect(screen.queryByText("selected")).not.toBeInTheDocument();
	});
});
