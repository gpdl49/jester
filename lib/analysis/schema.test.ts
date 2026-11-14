import { describe, expect, it } from "vitest";
import { ANALYSIS_SYSTEM_PROMPT } from "./prompt";
import {
	MEME_ANALYSIS_JSON_SCHEMA,
	memeAnalysisResultSchema,
	normalizeHashtag,
	slugify,
} from "./schema";

describe("slugify", () => {
	it("lowercases and slugifies string input", () => {
		expect(slugify("Drake Hotline Bling")).toBe("drake-hotline-bling");
		expect(slugify("  Surreal & Weird!!  ")).toBe("surreal-weird");
		expect(slugify("it's a meme")).toBe("its-a-meme");
		expect(slugify("---hello---world---")).toBe("hello-world");
		expect(slugify("")).toBe("");
	});
});

describe("normalizeHashtag", () => {
	it("strips leading '#' and normalizes to a clean slug", () => {
		expect(normalizeHashtag("#funny")).toBe("funny");
		expect(normalizeHashtag("###DankMemes")).toBe("dankmemes");
		expect(normalizeHashtag("#programmer_humor")).toBe("programmer-humor");
		expect(normalizeHashtag("")).toBe("");
	});
});

describe("MEME_ANALYSIS_JSON_SCHEMA", () => {
	it("is strict: additionalProperties false and all properties required", () => {
		expect(MEME_ANALYSIS_JSON_SCHEMA.additionalProperties).toBe(false);
		expect(MEME_ANALYSIS_JSON_SCHEMA.type).toBe("object");

		const rootProps = Object.keys(MEME_ANALYSIS_JSON_SCHEMA.properties);
		expect(MEME_ANALYSIS_JSON_SCHEMA.required).toEqual(
			expect.arrayContaining(rootProps),
		);
		expect(MEME_ANALYSIS_JSON_SCHEMA.required.length).toBe(rootProps.length);

		// sensitivity object
		const sensitivity = MEME_ANALYSIS_JSON_SCHEMA.properties.sensitivity;
		expect(sensitivity.additionalProperties).toBe(false);
		const sensitivityProps = Object.keys(sensitivity.properties);
		expect(sensitivity.required).toEqual(
			expect.arrayContaining(sensitivityProps),
		);
		expect(sensitivity.required.length).toBe(sensitivityProps.length);

		// quality object
		const quality = MEME_ANALYSIS_JSON_SCHEMA.properties.quality;
		expect(quality.additionalProperties).toBe(false);
		const qualityProps = Object.keys(quality.properties);
		expect(quality.required).toEqual(expect.arrayContaining(qualityProps));
		expect(quality.required.length).toBe(qualityProps.length);

		// attributionClues object
		const attributionClues =
			MEME_ANALYSIS_JSON_SCHEMA.properties.attributionClues;
		expect(attributionClues.additionalProperties).toBe(false);
		const clueProps = Object.keys(attributionClues.properties);
		expect(attributionClues.required).toEqual(
			expect.arrayContaining(clueProps),
		);
		expect(attributionClues.required.length).toBe(clueProps.length);
	});

	it("matches schema snapshot", () => {
		expect(MEME_ANALYSIS_JSON_SCHEMA).toMatchSnapshot();
	});

	it("matches prompt snapshot", () => {
		expect(ANALYSIS_SYSTEM_PROMPT).toMatchSnapshot();
	});
});

describe("memeAnalysisResultSchema", () => {
	it("parses and clamps valid raw output", () => {
		const raw = {
			ocrText: "Top text\nBottom text",
			description: "Classic image macro meme",
			altText: "A".repeat(300), // > 250 chars
			template: "  Drake Hotline Bling  ",
			language: "en",
			era: " 2015-2016 ",
			topics: [
				"Tech",
				"tech",
				"Coding",
				"Web Dev",
				"Python",
				"JavaScript",
				"AI",
				"Humor",
				"Work",
				"Extra",
			], // > 8 topics & duplicates
			styles: [
				"Wholesome",
				"WHOLESOME",
				"Comic",
				"Surreal",
				"Deepfried",
				"Extra",
			], // > 4 styles & duplicates
			sensitivity: {
				nsfw: false,
				politics: false,
				slurs: false,
				personalData: false,
				notes: null,
			},
			quality: {
				lowRes: false,
				heavyCompression: true,
				cropped: false,
				watermark: false,
			},
			postability: 125.7, // > 100 float
			captionDraft: "When the code finally works #coding #dev life",
			hashtags: [
				"#funny",
				"funny",
				"#memes",
				"code",
				"dev",
				"tech",
				"humor",
				"lol",
				"python",
				"js",
				"react",
				"web",
				"software",
				"engineer",
				"work",
				"extra1",
				"extra2",
			], // > 15 hashtags & duplicates with '#'
			attributionClues: {
				watermarks: ["@watermark"],
				handles: ["@dev"],
				sites: ["reddit.com"],
				subreddits: ["r/programmerhumor"],
			},
		};

		const parsed = memeAnalysisResultSchema.parse(raw);

		expect(parsed.altText.length).toBe(250);
		expect(parsed.template).toBe("Drake Hotline Bling");
		expect(parsed.era).toBe("2015-2016");
		expect(parsed.postability).toBe(100);
		expect(parsed.captionDraft).toBe("When the code finally works life");

		// Deduped and clamped to max 8 topics
		expect(parsed.topics).toEqual([
			"tech",
			"coding",
			"web-dev",
			"python",
			"javascript",
			"ai",
			"humor",
			"work",
		]);
		expect(parsed.topics.length).toBe(8);

		// Deduped and clamped to max 4 styles
		expect(parsed.styles).toEqual([
			"wholesome",
			"comic",
			"surreal",
			"deepfried",
		]);
		expect(parsed.styles.length).toBe(4);

		// Deduped and clamped to max 15 hashtags
		expect(parsed.hashtags.length).toBe(15);
		expect(parsed.hashtags[0]).toBe("funny");
		expect(parsed.hashtags[1]).toBe("memes");
		expect(parsed.hashtags).not.toContain("#funny");
	});

	it("clamps negative postability to 0 and converts empty template to null", () => {
		const raw = {
			ocrText: "",
			description: "Some image",
			altText: "Description",
			template: "   ",
			language: "en",
			era: "",
			topics: [],
			styles: [],
			sensitivity: {
				nsfw: false,
				politics: false,
				slurs: false,
				personalData: true,
				notes: "Chat screenshot with phone numbers",
			},
			quality: {
				lowRes: true,
				heavyCompression: false,
				cropped: true,
				watermark: true,
			},
			postability: -20,
			captionDraft: "Check this out",
			hashtags: [],
			attributionClues: {
				watermarks: [],
				handles: [],
				sites: [],
				subreddits: [],
			},
		};

		const parsed = memeAnalysisResultSchema.parse(raw);
		expect(parsed.postability).toBe(0);
		expect(parsed.template).toBeNull();
		expect(parsed.era).toBeNull();
		expect(parsed.sensitivity.personalData).toBe(true);
	});
});
