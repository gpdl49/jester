import sharp from "sharp";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { memeKey } from "@/lib/s3";
import { pngImage, twoTone } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
import { fakeAsset, installFakeImmich } from "@/test/helpers/immich";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { generateRenditions } from "./renditions";

describeWithDb("media renditions", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
	});

	afterEach(() => {
		fakeS3.restore();
	});

	it("generates display and thumb webp renditions for a PNG", async () => {
		const meme = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
		});

		const originalBytes = await pngImage(200, 150);
		fakeS3.upload(
			memeKey(meme.id, "original", "image/png"),
			originalBytes,
			"image/png",
		);

		await generateRenditions(meme.id);

		const updated = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});
		expect(updated.renditionsReady).toBe(true);
		expect(updated.dhash).toMatch(/^[0-9a-f]{16}$/);
		expect(updated.blurhash).toBeTruthy();

		// Check S3 display and thumb
		const displayObj = fakeS3.objects.get(memeKey(meme.id, "display"));
		expect(displayObj).toBeDefined();
		expect(displayObj?.contentType).toBe("image/webp");
		const displayMeta = await sharp(displayObj?.body).metadata();
		expect(displayMeta.format).toBe("webp");
		expect(
			Math.max(displayMeta.width ?? 0, displayMeta.height ?? 0),
		).toBeLessThanOrEqual(1600);

		const thumbObj = fakeS3.objects.get(memeKey(meme.id, "thumb"));
		expect(thumbObj).toBeDefined();
		expect(thumbObj?.contentType).toBe("image/webp");
		const thumbMeta = await sharp(thumbObj?.body).metadata();
		expect(thumbMeta.format).toBe("webp");
		expect(
			Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0),
		).toBeLessThanOrEqual(400);
	});

	it("generates first-frame renditions for a GIF", async () => {
		const meme = await createMeme({
			contentType: "image/gif",
			renditionsReady: false,
		});

		const gifBytes = await (await twoTone(120, 80)).gif().toBuffer();
		fakeS3.upload(
			memeKey(meme.id, "original", "image/gif"),
			gifBytes,
			"image/gif",
		);

		await generateRenditions(meme.id);

		const updated = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});
		expect(updated.renditionsReady).toBe(true);

		const displayObj = fakeS3.objects.get(memeKey(meme.id, "display"));
		expect(displayObj).toBeDefined();
		const displayMeta = await sharp(displayObj?.body).metadata();
		expect(displayMeta.format).toBe("webp");
		expect(displayMeta.pages ?? 1).toBe(1);
	});

	it("scales tall 1170x2532 screenshot correctly", async () => {
		const meme = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
			width: 1170,
			height: 2532,
		});

		const tallBytes = await sharp({
			create: {
				width: 1170,
				height: 2532,
				channels: 3,
				background: "#123456",
			},
		})
			.png()
			.toBuffer();

		fakeS3.upload(
			memeKey(meme.id, "original", "image/png"),
			tallBytes,
			"image/png",
		);

		await generateRenditions(meme.id);

		const displayObj = fakeS3.objects.get(memeKey(meme.id, "display"));
		const displayMeta = await sharp(displayObj?.body).metadata();
		expect(displayMeta.height).toBe(1600);
		expect(displayMeta.width).toBe(Math.round((1170 * 1600) / 2532));

		const thumbObj = fakeS3.objects.get(memeKey(meme.id, "thumb"));
		const thumbMeta = await sharp(thumbObj?.body).metadata();
		expect(thumbMeta.height).toBe(400);
		expect(thumbMeta.width).toBe(Math.round((1170 * 400) / 2532));
	});

	it("detects and links near-duplicates by dHash", async () => {
		const meme1 = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});

		const img1 = await (await twoTone(1000, 800)).png().toBuffer();
		fakeS3.upload(
			memeKey(meme1.id, "original", "image/png"),
			img1,
			"image/png",
		);
		await generateRenditions(meme1.id);

		const updated1 = await db().meme.findUniqueOrThrow({
			where: { id: meme1.id },
		});
		expect(updated1.duplicateOfId).toBeNull();

		// Meme 2: slightly resized version of the same image
		const meme2 = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
			createdAt: new Date("2026-01-02T00:00:00Z"),
		});

		const img2 = await sharp(img1).resize(800, 640).png().toBuffer();
		fakeS3.upload(
			memeKey(meme2.id, "original", "image/png"),
			img2,
			"image/png",
		);
		await generateRenditions(meme2.id);

		const updated2 = await db().meme.findUniqueOrThrow({
			where: { id: meme2.id },
		});
		expect(updated2.duplicateOfId).toBe(meme1.id);
	});

	it("uses Immich fullsize thumbnail for HEIC sources", async () => {
		const immichAsset = await createImmichAsset({
			mimeType: "image/heic",
		});

		const meme = await createMeme({
			contentType: "image/heic",
			renditionsReady: false,
		});

		await db().immichAsset.update({
			where: { id: immichAsset.id },
			data: { memeId: meme.id },
		});

		const fullsizeJpeg = await (await twoTone(800, 600)).jpeg().toBuffer();
		const fakeAssetItem = fakeAsset({
			id: immichAsset.immichId,
			bytes: fullsizeJpeg,
			originalMimeType: "image/heic",
		});

		installFakeImmich([fakeAssetItem]);

		fakeS3.upload(
			memeKey(meme.id, "original", "image/heic"),
			new Uint8Array([1, 2, 3]),
			"image/heic",
		);

		await generateRenditions(meme.id);

		const updated = await db().meme.findUniqueOrThrow({
			where: { id: meme.id },
		});
		expect(updated.renditionsReady).toBe(true);

		const displayObj = fakeS3.objects.get(memeKey(meme.id, "display"));
		expect(displayObj).toBeDefined();
		const meta = await sharp(displayObj?.body).metadata();
		expect(meta.format).toBe("webp");
	});

	it("near-duplicate links point newer -> older and never form a cycle, in either run order", async () => {
		const older = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const newer = await createMeme({
			contentType: "image/png",
			renditionsReady: false,
			createdAt: new Date("2026-01-02T00:00:00Z"),
		});
		const img1 = await (await twoTone(1000, 800)).png().toBuffer();
		const img2 = await sharp(img1).resize(800, 640).png().toBuffer();
		fakeS3.upload(
			memeKey(older.id, "original", "image/png"),
			img1,
			"image/png",
		);
		fakeS3.upload(
			memeKey(newer.id, "original", "image/png"),
			img2,
			"image/png",
		);

		// Concurrent jobs: the newer one finishes first, the older one second.
		await generateRenditions(newer.id);
		await generateRenditions(older.id);

		const o = await db().meme.findUniqueOrThrow({ where: { id: older.id } });
		const n = await db().meme.findUniqueOrThrow({ where: { id: newer.id } });
		expect(o.duplicateOfId).toBeNull();
		expect(n.duplicateOfId).toBe(older.id);
	});
});
