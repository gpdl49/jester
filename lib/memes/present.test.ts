import { describe, expect, it } from "vitest";
import { presentMemeDetail, presentMemeSummary } from "./present";
import { decodeCursor, encodeCursor } from "./service";

describe("cursor encoding", () => {
	it("encodes and decodes cursor stably", () => {
		const cursor = encodeCursor("2026-11-14T12:00:00.000Z", "meme-123");
		const decoded = decodeCursor(cursor);
		expect(decoded).toEqual(["2026-11-14T12:00:00.000Z", "meme-123"]);
	});

	it("returns null for malformed cursors", () => {
		expect(decodeCursor("invalid-base64")).toBeNull();
		expect(
			decodeCursor(Buffer.from("not-json").toString("base64url")),
		).toBeNull();
		expect(
			decodeCursor(
				Buffer.from(JSON.stringify({ not: "array" })).toString("base64url"),
			),
		).toBeNull();
	});
});

describe("presentMemeSummary", () => {
	it("presents summary DTO correctly", () => {
		const now = new Date("2026-11-14T12:00:00.000Z");
		const meme = {
			id: "00000000-0000-0000-0000-000000000001",
			source: "immich" as const,
			status: "inbox" as const,
			contentType: "image/png",
			size: 1024,
			width: 800,
			height: 600,
			sha256: "hash123",
			dhash: "dhash123",
			blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4",
			takenAt: now,
			ocrText: "text",
			description: "A funny cat",
			altText: "Cat meme",
			template: "drake",
			language: "en",
			era: "classic",
			postability: 85,
			captionDraft: "caption",
			hashtags: ["cat", "meme"],
			sensitivity: {
				nsfw: false,
				politics: false,
				slurs: false,
				personalData: false,
				notes: null,
			},
			quality: {
				lowRes: false,
				heavyCompression: false,
				cropped: false,
				watermark: false,
			},
			rating: 4,
			notes: "note",
			duplicateOfId: null,
			attributionId: "00000000-0000-0000-0000-000000000002",
			creditText: "@catcreator",
			renditionsReady: true,
			userEdited: [],
			approvedById: null,
			approvedAt: null,
			createdAt: now,
			updatedAt: now,
			tags: [
				{
					memeId: "00000000-0000-0000-0000-000000000001",
					tagId: "t1",
					source: "ai" as const,
					tag: { id: "t1", name: "cat", kind: "topic" as const },
				},
				{
					memeId: "00000000-0000-0000-0000-000000000001",
					tagId: "t2",
					source: "user" as const,
					tag: { id: "t2", name: "favorite", kind: "user" as const },
				},
			],
			postItems: [
				{
					postId: "p1",
					memeId: "00000000-0000-0000-0000-000000000001",
					position: 0,
					altText: null,
					post: {
						id: "p1",
						accountId: null,
						kind: "image" as const,
						status: "cancelled" as const,
						caption: "",
						queuePosition: null,
						scheduledAt: null,
						slotId: null,
						containerIds: [],
						containerAt: null,
						igMediaId: null,
						permalink: null,
						publishedAt: null,
						attempts: 0,
						error: null,
						createdById: null,
						createdAt: now,
						updatedAt: now,
					},
				},
				{
					postId: "p2",
					memeId: "00000000-0000-0000-0000-000000000001",
					position: 0,
					altText: null,
					post: {
						id: "p2",
						accountId: null,
						kind: "image" as const,
						status: "queued" as const,
						caption: "",
						queuePosition: 1,
						scheduledAt: null,
						slotId: null,
						containerIds: [],
						containerAt: null,
						igMediaId: null,
						permalink: null,
						publishedAt: null,
						attempts: 0,
						error: null,
						createdById: null,
						createdAt: now,
						updatedAt: now,
					},
				},
			],
		};

		const dto = presentMemeSummary(meme);
		expect(dto.id).toBe("00000000-0000-0000-0000-000000000001");
		expect(dto.thumbUrl).toBe(
			"/api/memes/00000000-0000-0000-0000-000000000001/media/thumb",
		);
		expect(dto.hasAttribution).toBe(true);
		expect(dto.postId).toBe("p2");
		expect(dto.postStatus).toBe("queued");
		expect(dto.tags).toEqual([
			{ name: "cat", kind: "topic", source: "ai" },
			{ name: "favorite", kind: "user", source: "user" },
		]);
	});
});

describe("presentMemeDetail", () => {
	it("presents detail DTO correctly with all subresources", () => {
		const now = new Date("2026-11-14T12:00:00.000Z");
		const meme = {
			id: "00000000-0000-0000-0000-000000000001",
			source: "upload" as const,
			status: "approved" as const,
			contentType: "image/jpeg",
			size: 2048,
			width: 1200,
			height: 800,
			sha256: "hash456",
			dhash: "dhash456",
			blurhash: "L6PZfSi_.AyE",
			takenAt: null,
			ocrText: "Sample text",
			description: "Desc",
			altText: "Alt",
			template: "custom",
			language: "en",
			era: "modern",
			postability: 90,
			captionDraft: "Draft",
			hashtags: ["cool"],
			sensitivity: null,
			quality: {
				lowRes: false,
				heavyCompression: false,
				cropped: false,
				watermark: false,
			},
			rating: 5,
			notes: "Great meme",
			duplicateOfId: null,
			attributionId: "c1",
			creditText: "Credit @user",
			renditionsReady: true,
			userEdited: ["description"],
			approvedById: "u1",
			approvedAt: now,
			createdAt: now,
			updatedAt: now,
			tags: [],
			postItems: [],
			immichAsset: { immichId: "immich-123" },
			analyses: [
				{
					id: "a1",
					memeId: "00000000-0000-0000-0000-000000000001",
					kind: "meme" as const,
					model: "gemini",
					status: "done" as const,
					result: { test: true },
					error: null,
					costUsd: 0.002,
					createdAt: now,
					updatedAt: now,
				},
			],
			candidates: [
				{
					id: "c1",
					memeId: "00000000-0000-0000-0000-000000000001",
					analysisId: "a1",
					creatorName: "Creator",
					handle: "creator_h",
					platform: "instagram" as const,
					url: "https://instagram.com/p/123",
					evidence: "Evidence",
					confidence: 0.95,
					rank: 1,
					confirmedById: "u1",
					confirmedAt: now,
					rejectedAt: null,
					createdAt: now,
				},
			],
			attribution: {
				id: "c1",
				memeId: "00000000-0000-0000-0000-000000000001",
				analysisId: "a1",
				creatorName: "Creator",
				handle: "creator_h",
				platform: "instagram" as const,
				url: "https://instagram.com/p/123",
				evidence: "Evidence",
				confidence: 0.95,
				rank: 1,
				confirmedById: "u1",
				confirmedAt: now,
				rejectedAt: null,
				createdAt: now,
			},
			duplicates: [],
			approvedUser: { id: "u1", email: "admin@example.com", username: "admin" },
		};

		const dto = presentMemeDetail(meme);
		expect(dto.id).toBe("00000000-0000-0000-0000-000000000001");
		expect(dto.displayUrl).toBe(
			"/api/memes/00000000-0000-0000-0000-000000000001/media/display",
		);
		expect(dto.originalUrl).toBe(
			"/api/memes/00000000-0000-0000-0000-000000000001/media/original",
		);
		expect(dto.immichId).toBe("immich-123");
		expect(dto.approvedBy).toEqual({
			id: "u1",
			email: "admin@example.com",
			username: "admin",
		});
		expect(dto.analyses).toHaveLength(1);
		expect(dto.candidates).toHaveLength(1);
		expect(dto.attribution?.handle).toBe("creator_h");
	});
});
