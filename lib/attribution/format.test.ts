import { describe, expect, it } from "vitest";
import { formatCreditText, formatPlatformName } from "./format";

describe("attribution formatting", () => {
	describe("formatPlatformName", () => {
		it("formats platforms nicely", () => {
			expect(formatPlatformName("instagram")).toBe("Instagram");
			expect(formatPlatformName("x")).toBe("X");
			expect(formatPlatformName("reddit")).toBe("Reddit");
			expect(formatPlatformName("tiktok")).toBe("TikTok");
			expect(formatPlatformName("tumblr")).toBe("Tumblr");
			expect(formatPlatformName("ninegag")).toBe("9GAG");
			expect(formatPlatformName("ifunny")).toBe("iFunny");
			expect(formatPlatformName("web")).toBe("Web");
		});
	});

	describe("formatCreditText", () => {
		it("uses @handle on Platform when handle is present", () => {
			expect(
				formatCreditText({
					handle: "sarahandersen",
					platform: "instagram",
					creatorName: "Sarah Andersen",
					url: "https://instagram.com/sarahandersen",
				}),
			).toBe("@sarahandersen on Instagram");

			expect(
				formatCreditText({
					handle: "@shenanigansen",
					platform: "x",
				}),
			).toBe("@shenanigansen on X");
		});

		it("falls back to creatorName when handle is absent", () => {
			expect(
				formatCreditText({
					handle: null,
					platform: "reddit",
					creatorName: "Randall Munroe",
					url: "https://xkcd.com/123",
				}),
			).toBe("Randall Munroe");
		});

		it("falls back to url hostname when handle and creatorName are absent", () => {
			expect(
				formatCreditText({
					handle: null,
					platform: "web",
					creatorName: null,
					url: "https://www.example.com/comics/1",
				}),
			).toBe("example.com");
		});

		it("falls back to platform name when everything else is absent", () => {
			expect(
				formatCreditText({
					handle: null,
					platform: "tumblr",
					creatorName: null,
					url: null,
				}),
			).toBe("Tumblr");
		});
	});
});
