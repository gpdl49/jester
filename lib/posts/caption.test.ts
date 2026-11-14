import { describe, expect, it } from "vitest";
import { renderCaption } from "./caption";

describe("renderCaption", () => {
	it("renders a standard caption with confirmed attribution and hashtags", async () => {
		const result = await renderCaption({
			caption: "Look at this cat",
			items: [
				{
					meme: {
						creditText: "catlover",
						hashtags: ["cat", "cute", "#funny"],
					},
				},
			],
		});

		expect(result.text).toBe(
			"Look at this cat\n\n📸 catlover\n\n#cat #cute #funny",
		);
		expect(result.warnings).toEqual([]);
	});

	it("uses unknown credit setting and emits warning when no attribution confirmed", async () => {
		const result = await renderCaption({
			caption: "Mystery meme",
			items: [
				{
					meme: {
						creditText: null,
						hashtags: ["meme"],
					},
				},
			],
		});

		expect(result.text).toBe(
			"Mystery meme\n\nCreator unknown — DM for credit/removal\n\n#meme",
		);
		expect(result.warnings).toContain("Unknown creator");
	});

	it("deduplicates credits and joins with ' · ' for carousels", async () => {
		const result = await renderCaption({
			caption: "A carousel",
			items: [
				{ meme: { creditText: "artist1", hashtags: [] } },
				{ meme: { creditText: "artist2", hashtags: [] } },
				{ meme: { creditText: "artist1", hashtags: [] } }, // duplicate
			],
		});

		expect(result.text).toBe("A carousel\n\n📸 artist1 · 📸 artist2");
		expect(result.warnings).toEqual([]);
	});

	it("emits warning when some items in a carousel have unknown creators", async () => {
		const result = await renderCaption({
			caption: "Mixed carousel",
			items: [
				{ meme: { creditText: "known", hashtags: [] } },
				{ meme: { creditText: null, hashtags: [] } },
			],
		});

		expect(result.text).toBe("Mixed carousel\n\n📸 known");
		expect(result.warnings).toContain("Unknown creator");
	});

	it("deduplicates hashtags and caps at 30 with warning", async () => {
		const tags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
		const result = await renderCaption({
			caption: "Lots of tags",
			items: [
				{
					meme: {
						creditText: "artist",
						hashtags: [...tags, "tag0", "#tag1"], // duplicates
					},
				},
			],
		});

		expect(result.warnings).toContain("Hashtags trimmed to 30");
		const tagLine = result.text.split("\n\n")[2] ?? "";
		const renderedTags = tagLine.split(" ").map((t) => t.replace("#", ""));
		expect(renderedTags).toHaveLength(30);
		expect(renderedTags[0]).toBe("tag0");
		expect(renderedTags[29]).toBe("tag29");
	});

	it("collapses 3+ newlines to 2 and trims extra whitespace", async () => {
		const result = await renderCaption({
			caption: "Line 1\n\n\n\n\nLine 2",
			items: [
				{
					meme: {
						creditText: "artist",
						hashtags: [],
					},
				},
			],
		});

		expect(result.text).toBe("Line 1\n\nLine 2\n\n📸 artist");
	});

	it("truncates caption when over 2200 characters without truncating credit", async () => {
		const longCaption = "A".repeat(2300);
		const result = await renderCaption({
			caption: longCaption,
			items: [
				{
					meme: {
						creditText: "artist_with_a_name",
						hashtags: ["one", "two"],
					},
				},
			],
		});

		expect(result.warnings).toContain(
			"Caption exceeds 2,200 characters (truncated)",
		);
		expect(result.text.length).toBeLessThanOrEqual(2200);
		expect(result.text).toContain("📸 artist_with_a_name");
		expect(result.text).toContain("#one #two");
	});

	it("flags sensitive content from meme.sensitivity", async () => {
		const result = await renderCaption({
			caption: "Spicy post",
			items: [
				{
					meme: {
						creditText: "artist",
						hashtags: [],
						sensitivity: {
							nsfw: true,
							politics: false,
							slurs: false,
							personalData: false,
							notes: null,
						},
					},
				},
			],
		});

		expect(result.warnings).toContain("Post contains sensitive content");
	});

	it("keeps user text literal: $-patterns and placeholder look-alikes", async () => {
		const result = await renderCaption({
			caption: "Only $& and $1 and $' here, also {credit} and {hashtags}",
			items: [{ meme: { creditText: "someone", hashtags: ["a"] } }],
		});

		expect(result.text).toBe(
			"Only $& and $1 and $' here, also {credit} and {hashtags}\n\n📸 someone\n\n#a",
		);
	});
});
