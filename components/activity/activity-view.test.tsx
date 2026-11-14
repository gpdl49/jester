// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEventDto, Paged } from "@/lib/api/types";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { ActivityView } from "./activity-view";

const mockAuditEvents: Paged<AuditEventDto> = {
	items: [
		{
			id: "ev-1",
			actor: { id: "u-1", username: "vidur", email: "v@example.com" },
			action: "settings.update",
			subjectType: "setting",
			subjectId: null,
			data: { changes: { "prefilter.threshold": { from: 0.35, to: 0.4 } } },
			at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
		},
		{
			id: "ev-2",
			actor: null,
			action: "immich.delete",
			subjectType: "immich_asset",
			subjectId: "asset-uuid-1",
			data: {
				memeId: "meme-uuid-1",
				immichId: "immich-photo-1",
				status: "done",
				verifiedSha256: "abc123456789",
			},
			at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
		},
	],
	nextCursor: null,
};

afterEach(cleanup);

describe("ActivityView component", () => {
	it("renders audit events and switches to Immich deletions tab", async () => {
		mockApi({
			"GET /api/audit": mockAuditEvents,
		});

		renderWithQuery(<ActivityView />);

		// Wait for data load
		await waitFor(() => {
			expect(screen.getByText("settings.update")).toBeInTheDocument();
		});

		// Check actor and details
		expect(screen.getByText("vidur")).toBeInTheDocument();
		expect(screen.getByText("System")).toBeInTheDocument();
		expect(screen.getByText("immich.delete")).toBeInTheDocument();

		// Switch to Immich deletions tab
		const deletionsTab = screen.getByRole("button", {
			name: /Immich Deletions/,
		});
		fireEvent.click(deletionsTab);

		await waitFor(() => {
			expect(screen.getAllByText("DONE")[0]).toBeInTheDocument();
		});

		expect(screen.getByText("View Meme")).toHaveAttribute(
			"href",
			"/memes/meme-uuid-1",
		);
		expect(screen.getByText(/Verified SHA-256:/)).toBeInTheDocument();
	});
});
