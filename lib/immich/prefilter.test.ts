import { describe, expect, it } from "vitest";
import { scorePrefilter } from "./prefilter";

describe("scorePrefilter", () => {
	it("returns 0 score and empty signals for a normal camera photo", () => {
		const result = scorePrefilter({
			originalFileName: "DSC_0001.JPG",
			mimeType: "image/jpeg",
			cameraMake: "Sony",
			cameraModel: "A7IV",
			width: 4000,
			height: 3000,
		});
		expect(result.score).toBe(0);
		expect(result.signals).toEqual({});
	});

	it.each([
		{ mime: "image/png", expected: true },
		{ mime: "image/webp", expected: true },
		{ mime: "image/gif", expected: true },
		{ mime: "image/PNG", expected: true },
		{ mime: "image/jpeg", expected: false },
		{ mime: "image/heic", expected: false },
	])("tests MIME type $mime", ({ mime, expected }) => {
		const result = scorePrefilter({
			originalFileName: "test.jpg",
			mimeType: mime,
			cameraMake: "Apple",
			cameraModel: "iPhone",
			width: 4000,
			height: 3000,
		});
		if (expected) {
			expect(result.signals.mime).toBe(true);
			expect(result.score).toBe(0.3);
		} else {
			expect(result.signals.mime).toBeUndefined();
			expect(result.score).toBe(0);
		}
	});

	it.each([
		{ name: "Screenshot_2023.jpg", match: true },
		{ name: "my screen shot.jpg", match: true },
		{ name: "IMG_1234.PNG", match: true },
		{ name: "IMG_1234.png", match: true },
		{ name: "IMG_1234.PNG.jpg", match: false },
		{ name: "prefix_IMG_1234.PNG", match: false },
		{ name: "received_987654.jpg", match: true },
		{ name: "FB_IMG_12345.jpg", match: true },
		{ name: "IMG-20220101-WA0001.jpg", match: true },
		{ name: "post_from_reddit.jpg", match: true },
		{ name: "top_9gag_funny.jpg", match: true },
		{ name: "shared_on_ifunny.jpg", match: true },
		{ name: "a_funny_meme.jpg", match: true },
		{ name: "vacation_photo.jpg", match: false },
	])("tests filename $name", ({ name, match }) => {
		const result = scorePrefilter({
			originalFileName: name,
			mimeType: "image/jpeg",
			cameraMake: "Apple",
			cameraModel: "iPhone",
			width: 4000,
			height: 3000,
		});
		if (match) {
			expect(result.signals.filename).toBe(true);
			expect(result.score).toBe(0.25);
		} else {
			expect(result.signals.filename).toBeUndefined();
			expect(result.score).toBe(0);
		}
	});

	it("scores +0.15 when EXIF has no camera make or model", () => {
		const withCamera = scorePrefilter({
			originalFileName: "pic.jpg",
			mimeType: "image/jpeg",
			cameraMake: "Canon",
			cameraModel: "EOS R5",
			width: 4000,
			height: 3000,
		});
		expect(withCamera.signals.noCamera).toBeUndefined();
		expect(withCamera.score).toBe(0);

		const withoutCamera = scorePrefilter({
			originalFileName: "pic.jpg",
			mimeType: "image/jpeg",
			cameraMake: null,
			cameraModel: null,
			width: 4000,
			height: 3000,
		});
		expect(withoutCamera.signals.noCamera).toBe(true);
		expect(withoutCamera.score).toBe(0.15);

		const withEmptyStringCamera = scorePrefilter({
			originalFileName: "pic.jpg",
			mimeType: "image/jpeg",
			cameraMake: "  ",
			cameraModel: "",
			width: 4000,
			height: 3000,
		});
		expect(withEmptyStringCamera.signals.noCamera).toBe(true);
		expect(withEmptyStringCamera.score).toBe(0.15);
	});

	it.each([
		{ width: 1080, height: 1080, desc: "square", match: true },
		{
			width: 1170,
			height: 2532,
			desc: "iPhone screen (aspect ~2.16)",
			match: true,
		},
		{
			width: 1080,
			height: 2400,
			desc: "Android screen (aspect ~2.22)",
			match: true,
		},
		{ width: 1000, height: 1900, desc: "exact 1.9 aspect", match: true },
		{
			width: 3000,
			height: 4000,
			desc: "portrait camera (aspect 1.33)",
			match: false,
		},
		{ width: 2532, height: 1170, desc: "landscape 2.16", match: false },
		{ width: 0, height: 1000, desc: "invalid zero width", match: false },
	])(
		"tests dimensions $desc ($width x $height)",
		({ width, height, match }) => {
			const result = scorePrefilter({
				originalFileName: "pic.jpg",
				mimeType: "image/jpeg",
				cameraMake: "Apple",
				cameraModel: "iPhone",
				width,
				height,
			});
			if (match) {
				expect(result.signals.screenDims).toBe(true);
				expect(result.score).toBe(0.1);
			} else {
				expect(result.signals.screenDims).toBeUndefined();
				expect(result.score).toBe(0);
			}
		},
	);

	it("scores +0.30 when smartHits is present and non-empty", () => {
		const noHits = scorePrefilter(
			{
				originalFileName: "pic.jpg",
				mimeType: "image/jpeg",
				cameraMake: "Canon",
				cameraModel: "EOS",
				width: 4000,
				height: 3000,
			},
			{ smartHits: [] },
		);
		expect(noHits.signals.smartHit).toBeUndefined();
		expect(noHits.score).toBe(0);

		const withHits = scorePrefilter(
			{
				originalFileName: "pic.jpg",
				mimeType: "image/jpeg",
				cameraMake: "Canon",
				cameraModel: "EOS",
				width: 4000,
				height: 3000,
			},
			{ smartHits: ["funny meme with caption text"] },
		);
		expect(withHits.signals.smartHit).toBe(true);
		expect(withHits.score).toBe(0.3);
	});

	it.each([
		{ text: "one two three four five", match: true },
		{ text: "one two three four", match: false },
		{ text: "   lots   of \n space \t between five words   ", match: true },
		{ text: null, match: false },
		{ text: "", match: false },
	])("tests OCR text: '$text'", ({ text, match }) => {
		const result = scorePrefilter(
			{
				originalFileName: "pic.jpg",
				mimeType: "image/jpeg",
				cameraMake: "Canon",
				cameraModel: "EOS",
				width: 4000,
				height: 3000,
			},
			{ ocrText: text },
		);
		if (match) {
			expect(result.signals.ocrWords).toBe(true);
			expect(result.score).toBe(0.15);
		} else {
			expect(result.signals.ocrWords).toBeUndefined();
			expect(result.score).toBe(0);
		}
	});

	it("caps maximum score at 1.0 when all signals match", () => {
		const result = scorePrefilter(
			{
				originalFileName: "IMG_1234.PNG",
				mimeType: "image/png",
				cameraMake: null,
				cameraModel: null,
				width: 1170,
				height: 2532,
			},
			{
				smartHits: ["meme"],
				ocrText: "when you write tests and they pass immediately",
			},
		);
		// Sum is 0.30 + 0.25 + 0.15 + 0.10 + 0.30 + 0.15 = 1.25 -> capped at 1.0
		expect(result.score).toBe(1);
		expect(result.signals).toEqual({
			mime: true,
			filename: true,
			noCamera: true,
			screenDims: true,
			smartHit: true,
			ocrWords: true,
		});
	});

	it("combines multiple signals accurately without float precision artifacts", () => {
		// MIME (0.30) + Filename (0.25) + noCamera (0.15) = 0.70
		const result = scorePrefilter({
			originalFileName: "screenshot_test.png",
			mimeType: "image/png",
			cameraMake: null,
			cameraModel: null,
			width: 3000,
			height: 4000, // not phone screen aspect (1.33)
		});
		expect(result.score).toBe(0.7);
		expect(result.signals).toEqual({
			mime: true,
			filename: true,
			noCamera: true,
		});
	});
});
