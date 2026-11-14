// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers/dom";
import { FilterBar } from "./filter-bar";

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/memes",
	useSearchParams: () => mockSearchParams,
}));

describe("FilterBar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSearchParams = new URLSearchParams();
	});

	it("renders filter controls correctly", () => {
		renderWithQuery(<FilterBar />);
		expect(
			screen.getByPlaceholderText("Search name, brand, notes…"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Active" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Approved" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Sensitive" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Has attribution" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Duplicates" }),
		).toBeInTheDocument();
	});

	it("clicking a status tab updates the URL query string", () => {
		renderWithQuery(<FilterBar />);
		const inboxTab = screen.getByRole("button", { name: "Inbox" });
		fireEvent.click(inboxTab);

		expect(mockReplace).toHaveBeenCalledWith("/memes?status=inbox", {
			scroll: false,
		});
	});

	it("toggling sensitive filter updates the URL query string", () => {
		renderWithQuery(<FilterBar />);
		const sensitiveBtn = screen.getByRole("button", { name: "Sensitive" });
		fireEvent.click(sensitiveBtn);

		expect(mockReplace).toHaveBeenCalledWith("/memes?sensitive=true", {
			scroll: false,
		});
	});

	it("selecting sort order updates URL", () => {
		renderWithQuery(<FilterBar />);
		const sortSelect = screen.getByLabelText("Sort by");
		fireEvent.change(sortSelect, { target: { value: "rating" } });

		expect(mockReplace).toHaveBeenCalledWith("/memes?sort=rating", {
			scroll: false,
		});
	});

	it("clearing filters resets URL", () => {
		mockSearchParams = new URLSearchParams("status=inbox&sort=rating");
		renderWithQuery(<FilterBar />);

		const clearBtn = screen.getByRole("button", { name: "Clear filters" });
		fireEvent.click(clearBtn);

		expect(mockReplace).toHaveBeenCalledWith("/memes", { scroll: false });
	});
});
