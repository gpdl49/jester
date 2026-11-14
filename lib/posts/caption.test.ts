import { describe, expect, it } from "vitest";
import { renderCaption } from "./caption";

describe("renderCaption", () => {
	it("renders caption with credit and hashtags", async () => {
		const res = await renderCaption({
			caption: "My hilarious meme",
			items: [
				{
					meme: {
						creditText: "reddit/u/dankuser",
						hashtags: ["funny", "memes"],
					},
				},
			],
		});

		expect(res.text).toContain("My hilarious meme");
		expect(res.text).toContain("📸 reddit/u/dankuser");
		expect(res.text).toContain("#funny #memes");
		expect(res.warnings).toHaveLength(0);
	});

	it("uses unknown credit fallback when no creditText is present", async () => {
		const res = await renderCaption({
			caption: "No credit meme",
			items: [
				{
					meme: {
						creditText: null,
						hashtags: ["cat"],
					},
				},
			],
		});

		expect(res.text).toContain("Creator unknown — DM for credit/removal");
		expect(res.warnings).toHaveLength(0);
	});

	it("warns if more than 30 hashtags or >2200 characters", async () => {
		const hashtags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
		const res = await renderCaption({
			caption: "A".repeat(2300),
			items: [
				{
					meme: {
						creditText: null,
						hashtags,
					},
				},
			],
		});

		expect(res.warnings).toHaveLength(2);
		expect(res.warnings[0]).toContain("35 hashtags");
		expect(res.warnings[1]).toContain("characters");
	});
});
