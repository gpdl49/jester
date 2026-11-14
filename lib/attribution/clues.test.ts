import { describe, expect, it } from "vitest";
import {
	extractClues,
	isReposter,
	normalizeHandle,
	normalizeSite,
	normalizeSubreddit,
} from "./clues";

describe("clues extraction", () => {
	describe("normalizeHandle", () => {
		it("strips leading @ and u/ symbols", () => {
			expect(normalizeHandle("@comic_artist")).toBe("comic_artist");
			expect(normalizeHandle("@@double_at")).toBe("double_at");
			expect(normalizeHandle("u/reddit_user")).toBe("reddit_user");
			expect(normalizeHandle("/u/another_user")).toBe("another_user");
		});

		it("strips trailing punctuation", () => {
			expect(normalizeHandle("@artist.")).toBe("artist");
			expect(normalizeHandle("@artist,")).toBe("artist");
			expect(normalizeHandle("@artist!")).toBe("artist");
			expect(normalizeHandle("@artist?")).toBe("artist");
			expect(normalizeHandle("@artist: ")).toBe("artist");
			expect(normalizeHandle("@artist);")).toBe("artist");
			expect(normalizeHandle("@artist's")).toBe("artist's");
		});

		it("handles emojis and symbols at edges", () => {
			expect(normalizeHandle("@🎨artist")).toBe("artist");
			expect(normalizeHandle("@artist🎨")).toBe("artist");
			expect(normalizeHandle("✨@cool_creator✨")).toBe("cool_creator");
		});

		it("returns empty string on empty input", () => {
			expect(normalizeHandle("")).toBe("");
			expect(normalizeHandle("   ")).toBe("");
		});
	});

	describe("normalizeSubreddit", () => {
		it("strips leading r/ or /r/", () => {
			expect(normalizeSubreddit("r/programmerhumor")).toBe("programmerhumor");
			expect(normalizeSubreddit("/r/dankmemes")).toBe("dankmemes");
		});

		it("strips trailing punctuation and lowercases", () => {
			expect(normalizeSubreddit("r/ProgrammerHumor!")).toBe("programmerhumor");
			expect(normalizeSubreddit("r/memes,")).toBe("memes");
		});
	});

	describe("normalizeSite", () => {
		it("normalizes domains and strips protocols/paths", () => {
			expect(normalizeSite("https://twitter.com/user/status/123")).toBe(
				"twitter.com",
			);
			expect(normalizeSite("http://www.reddit.com/r/all")).toBe("reddit.com");
			expect(normalizeSite("instagram.com/p/abc?hl=en")).toBe("instagram.com");
		});
	});

	describe("isReposter", () => {
		it("identifies known meme aggregators", () => {
			expect(isReposter("9gag")).toBe(true);
			expect(isReposter("@9GAG")).toBe(true);
			expect(isReposter("ifunny")).toBe(true);
			expect(isReposter("memes")).toBe(true);
			expect(isReposter("pubity")).toBe(true);
			expect(isReposter("fuckjerry")).toBe(true);
			expect(isReposter("daquan")).toBe(true);
			expect(isReposter("ladbible")).toBe(true);
			expect(isReposter("9gag.com")).toBe(true);
			expect(isReposter("ifunny.co")).toBe(true);
		});

		it("does not flag original creator handles", () => {
			expect(isReposter("sarahscribbles")).toBe(false);
			expect(isReposter("shencomix")).toBe(false);
			expect(isReposter("xkcd")).toBe(false);
		});
	});

	describe("extractClues", () => {
		it("extracts handles, subreddits, sites, and watermarks from OCR text", () => {
			const ocrText = `
				Original comic by @sarahscribbles! Check it out on r/comics.
				Also posted on u/random_redditor at reddit.com.
				Made with mematic
			`;
			const clues = extractClues({ ocrText });

			expect(clues.handles).toContain("sarahscribbles");
			expect(clues.handles).toContain("random_redditor");
			expect(clues.subreddits).toContain("comics");
			expect(clues.sites).toContain("reddit.com");
			expect(clues.watermarks).toContain("Made with mematic");
		});

		it("marks known aggregator handles as reposters", () => {
			const ocrText = "Follow @pubity and @memes for more! Also @9gag.";
			const clues = extractClues({ ocrText });

			expect(clues.handles).toContain("pubity");
			expect(clues.handles).toContain("memes");
			expect(clues.handles).toContain("9gag");
			expect(clues.reposters).toContain("pubity");
			expect(clues.reposters).toContain("memes");
			expect(clues.reposters).toContain("9gag");
		});

		it("extracts signals from originalFileName", () => {
			const clues1 = extractClues({
				originalFileName: "reddit_programmerhumor_q9z10.png",
			});
			expect(clues1.subreddits).toContain("programmerhumor");
			expect(clues1.sites).toContain("reddit.com");

			const clues2 = extractClues({
				originalFileName: "FB_IMG_1592391238912.jpg",
			});
			expect(clues2.sites).toContain("facebook.com");

			const clues3 = extractClues({
				originalFileName: "IMG-20210410-WA0004.jpg",
			});
			expect(clues3.watermarks).toContain("WhatsApp");

			const clues4 = extractClues({
				originalFileName: "9gag_snapshot_123.jpg",
			});
			expect(clues4.sites).toContain("9gag.com");
			expect(clues4.handles).toContain("9gag");
			expect(clues4.reposters).toContain("9gag");
		});

		it("merges and deduplicates clues across all sources", () => {
			const clues = extractClues({
				ocrText: "Credit: @artist via twitter.com and r/funny",
				analysisClues: {
					handles: ["@ARTIST", "@other_creator"],
					subreddits: ["funny", "memes"],
					sites: ["https://twitter.com"],
					watermarks: ["watermark-1"],
				},
				originalFileName: "twitter_image_123.png",
			});

			expect(clues.handles).toEqual(["artist", "other_creator"]);
			expect(clues.subreddits).toEqual(["funny", "memes"]);
			expect(clues.sites).toContain("twitter.com");
			expect(clues.sites).toContain("x.com");
			expect(clues.watermarks).toContain("watermark-1");
			expect(clues.reposters).toContain("memes");
		});

		it("handles empty or null inputs gracefully", () => {
			const clues = extractClues({});
			expect(clues.handles).toEqual([]);
			expect(clues.subreddits).toEqual([]);
			expect(clues.sites).toEqual([]);
			expect(clues.watermarks).toEqual([]);
			expect(clues.reposters).toEqual([]);
		});
	});
});
