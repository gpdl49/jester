import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
	computeEdgeMedianColor,
	MAX_ASPECT_RATIO,
	MIN_ASPECT_RATIO,
	renderImageBuffer,
	TARGET_WIDTH,
	targetCanvas,
} from "./render";

describe("instagram rendition", () => {
	describe("targetCanvas geometry", () => {
		const cases = [
			{
				desc: "square 1:1 image",
				w: 1000,
				h: 1000,
				expectedCanvas: { w: 1080, h: 1080 },
				expectedImage: { w: 1080, h: 1080 },
				expectedPad: { left: 0, top: 0 },
			},
			{
				desc: "exact 4:5 portrait",
				w: 800,
				h: 1000,
				expectedCanvas: { w: 1080, h: 1350 },
				expectedImage: { w: 1080, h: 1350 },
				expectedPad: { left: 0, top: 0 },
			},
			{
				desc: "tall 9:16 phone screenshot (taller than 4:5 -> pad left/right)",
				w: 900,
				h: 1600,
				expectedCanvas: { w: 1080, h: 1350 },
				expectedImage: { w: 759, h: 1350 },
				expectedPad: { left: 161, top: 0 },
			},
			{
				desc: "exact 1.91:1 landscape",
				w: 1910,
				h: 1000,
				expectedCanvas: { w: 1080, h: 565 },
				expectedImage: { w: 1080, h: 565 },
				expectedPad: { left: 0, top: 0 },
			},
			{
				desc: "ultra-wide 3:1 banner (wider than 1.91:1 -> pad top/bottom)",
				w: 3000,
				h: 1000,
				expectedCanvas: { w: 1080, h: 565 },
				expectedImage: { w: 1080, h: 360 },
				expectedPad: { left: 0, top: 103 },
			},
			{
				desc: "carousel item forced to first item's 1:1 ratio",
				w: 900,
				h: 1600,
				targetRatio: 1.0,
				expectedCanvas: { w: 1080, h: 1080 },
				expectedImage: { w: 608, h: 1080 },
				expectedPad: { left: 236, top: 0 },
			},
		];

		for (const c of cases) {
			it(c.desc, () => {
				const geom = targetCanvas(c.w, c.h, c.targetRatio);
				expect(geom.canvasWidth).toBe(c.expectedCanvas.w);
				expect(geom.canvasHeight).toBe(c.expectedCanvas.h);
				expect(geom.imageWidth).toBe(c.expectedImage.w);
				expect(geom.imageHeight).toBe(c.expectedImage.h);
				expect(geom.left).toBe(c.expectedPad.left);
				expect(geom.top).toBe(c.expectedPad.top);
			});
		}
	});

	describe("computeEdgeMedianColor", () => {
		it("detects edge median color", async () => {
			// Create a 100x100 blue image with green center
			const img = await sharp({
				create: {
					width: 100,
					height: 100,
					channels: 3,
					background: { r: 10, g: 20, b: 200 },
				},
			})
				.png()
				.toBuffer();

			const color = await computeEdgeMedianColor(img);
			expect(color.r).toBe(10);
			expect(color.g).toBe(20);
			expect(color.b).toBe(200);
		});
	});

	describe("renderImageBuffer", () => {
		it("renders a tall image to 1080px wide JPEG clamped to 4:5 with padding", async () => {
			// Create a 400x800 red image
			const src = await sharp({
				create: {
					width: 400,
					height: 800,
					channels: 3,
					background: { r: 255, g: 0, b: 0 },
				},
			})
				.png()
				.toBuffer();

			const { buffer, geometry } = await renderImageBuffer(src);

			expect(geometry.canvasWidth).toBe(TARGET_WIDTH);
			expect(geometry.aspectRatio).toBe(MIN_ASPECT_RATIO);
			expect(buffer.length).toBeLessThanOrEqual(8 * 1024 * 1024);

			const meta = await sharp(buffer).metadata();
			expect(meta.format).toBe("jpeg");
			expect(meta.width).toBe(1080);
			expect(meta.height).toBe(1350);
		});

		it("renders a wide image to 1080px wide JPEG clamped to 1.91:1 with padding", async () => {
			// Create a 1000x300 image
			const src = await sharp({
				create: {
					width: 1000,
					height: 300,
					channels: 3,
					background: { r: 0, g: 255, b: 0 },
				},
			})
				.png()
				.toBuffer();

			const { buffer, geometry } = await renderImageBuffer(src);

			expect(geometry.canvasWidth).toBe(TARGET_WIDTH);
			expect(geometry.aspectRatio).toBe(MAX_ASPECT_RATIO);

			const meta = await sharp(buffer).metadata();
			expect(meta.format).toBe("jpeg");
			expect(meta.width).toBe(1080);
			expect(meta.height).toBe(565);
		});
	});
});
