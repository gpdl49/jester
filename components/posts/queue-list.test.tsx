// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PostSummaryDto } from "@/lib/api/types";
import { renderWithQuery } from "@/test/helpers/dom";
import { QueueList } from "./queue-list";

describe("QueueList component", () => {
	const sampleQueued: PostSummaryDto[] = [
		{
			id: "post-1",
			accountId: null,
			kind: "image",
			status: "queued",
			caption: "First queued post",
			queuePosition: 1,
			scheduledAt: null,
			publishedAt: null,
			permalink: null,
			error: null,
			thumbUrl: "/api/memes/m1/media/thumb",
			itemCount: 1,
			createdAt: "2026-03-01T10:00:00Z",
			updatedAt: "2026-03-01T10:00:00Z",
		},
		{
			id: "post-2",
			accountId: null,
			kind: "carousel",
			status: "queued",
			caption: "Second queued post",
			queuePosition: 2,
			scheduledAt: "2026-03-02T15:00:00Z",
			publishedAt: null,
			permalink: null,
			error: null,
			thumbUrl: "/api/memes/m2/media/thumb",
			itemCount: 3,
			createdAt: "2026-03-01T11:00:00Z",
			updatedAt: "2026-03-01T11:00:00Z",
		},
	];

	const sampleDrafts: PostSummaryDto[] = [
		{
			id: "post-3",
			accountId: null,
			kind: "image",
			status: "draft",
			caption: "Draft post",
			queuePosition: null,
			scheduledAt: null,
			publishedAt: null,
			permalink: null,
			error: null,
			thumbUrl: "/api/memes/m3/media/thumb",
			itemCount: 1,
			createdAt: "2026-03-01T12:00:00Z",
			updatedAt: "2026-03-01T12:00:00Z",
		},
	];

	it("renders queued and draft posts correctly", () => {
		renderWithQuery(
			<QueueList queuedPosts={sampleQueued} draftPosts={sampleDrafts} />,
		);

		expect(screen.getByText("Queued Posts (2)")).toBeInTheDocument();
		expect(screen.getByText("First queued post")).toBeInTheDocument();
		expect(screen.getByText("Second queued post")).toBeInTheDocument();
		expect(screen.getByText("#1 in queue")).toBeInTheDocument();

		expect(screen.getByText("Drafts (1)")).toBeInTheDocument();
		expect(screen.getByText("Draft post")).toBeInTheDocument();
	});

	it("displays empty state messages when lists are empty", () => {
		renderWithQuery(<QueueList queuedPosts={[]} draftPosts={[]} />);

		expect(screen.getByText(/No posts in the queue/i)).toBeInTheDocument();
		expect(screen.getByText(/No drafts saved/i)).toBeInTheDocument();
	});
});
