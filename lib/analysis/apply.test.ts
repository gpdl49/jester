import { beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { applyAnalysis } from "./apply";

describeWithDb("applyAnalysis", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("preserves fields listed in meme.userEdited while updating other AI fields", async () => {
		const meme = await createMeme({
			description: "User wrote this description",
			captionDraft: "User custom caption",
			hashtags: ["original", "userhashtag"],
			userEdited: ["description", "captionDraft", "hashtags"],
		});

		const analysis = await db().analysis.create({
			data: {
				memeId: meme.id,
				kind: "meme",
				status: "running",
			},
		});

		const rawResult = {
			ocrText: "Detected OCR text",
			description: "AI description that should be ignored",
			altText: "New alt text",
			template: "Drake Hotline Bling",
			language: "en",
			era: "2015",
			topics: ["programming"],
			styles: ["comic"],
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
			postability: 85,
			captionDraft: "AI caption that should be ignored",
			hashtags: ["aihashtag"],
			attributionClues: {
				watermarks: [],
				handles: [],
				sites: [],
				subreddits: [],
			},
		};

		const updatedAnalysis = await applyAnalysis(
			meme.id,
			analysis.id,
			rawResult,
			0.005,
			"test-model",
		);

		expect(updatedAnalysis.status).toBe("done");
		expect(updatedAnalysis.costUsd).toBe(0.005);
		expect(updatedAnalysis.model).toBe("test-model");

		const updatedMeme = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});

		// User edited fields MUST be preserved
		expect(updatedMeme.description).toBe("User wrote this description");
		expect(updatedMeme.captionDraft).toBe("User custom caption");
		expect(updatedMeme.hashtags).toEqual(["original", "userhashtag"]);

		// Non-user-edited fields MUST be updated
		expect(updatedMeme.ocrText).toBe("Detected OCR text");
		expect(updatedMeme.altText).toBe("New alt text");
		expect(updatedMeme.template).toBe("Drake Hotline Bling");
		expect(updatedMeme.postability).toBe(85);
		expect(updatedMeme.era).toBe("2015");
	});

	it("replaces previous AI tags, upserts new tags, and preserves user tags", async () => {
		const meme = await createMeme();

		// Create an existing user tag and an existing old AI tag
		const userTag = await db().tag.create({
			data: { name: "custom-user-tag", kind: "user" },
		});
		await db().memeTag.create({
			data: { memeId: meme.id, tagId: userTag.id, source: "user" },
		});

		const oldAiTag = await db().tag.create({
			data: { name: "old-ai-topic", kind: "topic" },
		});
		await db().memeTag.create({
			data: { memeId: meme.id, tagId: oldAiTag.id, source: "ai" },
		});

		const analysis = await db().analysis.create({
			data: {
				memeId: meme.id,
				kind: "meme",
				status: "running",
			},
		});

		const rawResult = {
			ocrText: "Some text",
			description: "Some desc",
			altText: "Some alt",
			template: "Distracted Boyfriend",
			language: "en",
			era: null,
			topics: ["gaming", "custom-user-tag"], // "custom-user-tag" already exists as user tag
			styles: ["screenshot"],
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
			postability: 70,
			captionDraft: "Caption draft",
			hashtags: ["gaming"],
			attributionClues: {
				watermarks: [],
				handles: [],
				sites: [],
				subreddits: [],
			},
		};

		await applyAnalysis(meme.id, analysis.id, rawResult, 0.002);

		// Verify tags on the meme
		const memeTags = await db().memeTag.findMany({
			where: { memeId: meme.id },
			include: { tag: true },
		});

		// 1. User tag must still be present with source "user"
		const userMemeTag = memeTags.find(
			(mt) => mt.tag.name === "custom-user-tag",
		);
		expect(userMemeTag).toBeDefined();
		expect(userMemeTag?.source).toBe("user");

		// 2. Old AI tag must be removed
		const oldMemeTag = memeTags.find((mt) => mt.tag.name === "old-ai-topic");
		expect(oldMemeTag).toBeUndefined();

		// 3. New AI tags: "gaming" (topic), "screenshot" (style), "distracted-boyfriend" (template)
		const gamingTag = memeTags.find((mt) => mt.tag.name === "gaming");
		expect(gamingTag).toBeDefined();
		expect(gamingTag?.source).toBe("ai");
		expect(gamingTag?.tag.kind).toBe("topic");

		const screenshotTag = memeTags.find((mt) => mt.tag.name === "screenshot");
		expect(screenshotTag).toBeDefined();
		expect(screenshotTag?.source).toBe("ai");
		expect(screenshotTag?.tag.kind).toBe("style");

		const templateTag = memeTags.find(
			(mt) => mt.tag.name === "distracted-boyfriend",
		);
		expect(templateTag).toBeDefined();
		expect(templateTag?.source).toBe("ai");
		expect(templateTag?.tag.kind).toBe("template");
	});
});
