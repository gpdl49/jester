import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/define";
import { memeKey, uploadKey } from "@/lib/s3";
import { pngImage } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
import { fakeAsset, installFakeImmich } from "@/test/helpers/immich";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { userId } from "@/test/helpers/users";
import { importFromImmich, importFromUpload } from "./import";

const enqueuedJobs: { name: string; data: unknown }[] = [];

vi.mock("@/lib/jobs/queue", () => ({
	enqueue: vi.fn(async (job: { name: string }, data: unknown) => {
		enqueuedJobs.push({ name: job.name, data });
		return "job-id";
	}),
}));

describeWithDb("media import", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		enqueuedJobs.length = 0;
	});

	afterEach(() => {
		fakeS3.restore();
		vi.clearAllMocks();
	});

	describe("importFromImmich", () => {
		it("fails if asset is not accepted", async () => {
			const asset = await createImmichAsset({
				triageStatus: "scored",
			});

			await expect(importFromImmich(asset.id)).rejects.toThrow(
				PermanentJobError,
			);
			expect(enqueuedJobs).toHaveLength(0);
		});

		it("aborts without delete and sets error on checksum mismatch", async () => {
			const correctBytes = await pngImage(100, 100);
			const wrongBytes = await pngImage(80, 80);

			// Asset has checksum of correctBytes
			const asset = await createImmichAsset({
				triageStatus: "accepted",
				checksum: createHash("sha1").update(correctBytes).digest("base64"),
			});

			// Immich serves wrongBytes
			const fake = fakeAsset({
				id: asset.immichId,
				bytes: wrongBytes,
			});
			installFakeImmich([fake]);

			await expect(importFromImmich(asset.id)).rejects.toThrow(
				"checksum mismatch",
			);

			// Asset updated to error
			const updated = await db().immichAsset.findUniqueOrThrow({
				where: { id: asset.id },
			});
			expect(updated.triageStatus).toBe("error");
			expect(updated.error).toBe("checksum mismatch");

			// Nothing in S3
			expect(fakeS3.objects.size).toBe(0);

			// No deletion or rendition enqueued
			expect(enqueuedJobs).toHaveLength(0);
		});

		it("imports accepted asset, uploads to S3, and enqueues jobs", async () => {
			const bytes = await pngImage(120, 90);
			const checksum = createHash("sha1").update(bytes).digest("base64");
			const sha256Hex = createHash("sha256").update(bytes).digest("hex");

			const asset = await createImmichAsset({
				triageStatus: "accepted",
				checksum,
				mimeType: "image/png",
			});

			const fake = fakeAsset({
				id: asset.immichId,
				bytes,
				checksum,
				originalMimeType: "image/png",
			});
			installFakeImmich([fake]);

			const result = await importFromImmich(asset.id);
			expect(result.memeId).toBeTruthy();

			// Meme created
			const meme = await db().meme.findUniqueOrThrow({
				where: { id: result.memeId },
			});
			expect(meme.source).toBe("immich");
			expect(meme.status).toBe("inbox");
			expect(meme.sha256).toBe(sha256Hex);
			expect(meme.width).toBe(120);
			expect(meme.height).toBe(90);

			// S3 object created
			const s3Obj = fakeS3.objects.get(
				memeKey(meme.id, "original", "image/png"),
			);
			expect(s3Obj).toBeDefined();
			expect(s3Obj?.contentType).toBe("image/png");

			// Asset updated to imported
			const updatedAsset = await db().immichAsset.findUniqueOrThrow({
				where: { id: asset.id },
			});
			expect(updatedAsset.triageStatus).toBe("imported");
			expect(updatedAsset.memeId).toBe(meme.id);

			// Enqueued media.renditions, analysis.meme, immich.delete
			expect(enqueuedJobs.map((j) => j.name)).toEqual([
				"media.renditions",
				"analysis.meme",
				"immich.delete",
			]);
		});

		it("is idempotent when asset is already imported", async () => {
			const meme = await createMeme();
			const asset = await createImmichAsset({
				triageStatus: "imported",
				memeId: meme.id,
			});

			const result = await importFromImmich(asset.id);
			expect(result.memeId).toBe(meme.id);

			// Enqueues immich.delete
			expect(enqueuedJobs).toEqual([
				{ name: "immich.delete", data: { immichAssetId: asset.id } },
			]);
		});

		it("links to existing meme on exact SHA-256 match without re-uploading", async () => {
			const bytes = await pngImage(100, 100);
			const checksum = createHash("sha1").update(bytes).digest("base64");
			const sha256Hex = createHash("sha256").update(bytes).digest("hex");

			const existingMeme = await createMeme({
				sha256: sha256Hex,
			});

			const asset = await createImmichAsset({
				triageStatus: "accepted",
				checksum,
				mimeType: "image/png",
			});

			const fake = fakeAsset({
				id: asset.immichId,
				bytes,
				checksum,
			});
			installFakeImmich([fake]);

			const result = await importFromImmich(asset.id);
			expect(result.memeId).toBe(existingMeme.id);

			// No new S3 upload
			expect(fakeS3.objects.size).toBe(0);

			// Immich asset marked imported
			const updatedAsset = await db().immichAsset.findUniqueOrThrow({
				where: { id: asset.id },
			});
			expect(updatedAsset.triageStatus).toBe("imported");
			expect(updatedAsset.memeId).toBe(existingMeme.id);

			// Enqueued only immich.delete
			expect(enqueuedJobs).toEqual([
				{ name: "immich.delete", data: { immichAssetId: asset.id } },
			]);
		});
	});

	describe("importFromUpload", () => {
		it("fails if upload is not complete", async () => {
			const uId = await userId();
			const upload = await db().upload.create({
				data: {
					uploaderId: uId,
					contentType: "image/png",
					size: 100,
					status: "pending",
				},
			});

			await expect(importFromUpload(upload.id)).rejects.toThrow(
				PermanentJobError,
			);
		});

		it("rejects MIME type mismatch and cleans up staging object", async () => {
			const uId = await userId();
			const upload = await db().upload.create({
				data: {
					uploaderId: uId,
					contentType: "image/jpeg", // declared JPEG
					size: 1000,
					status: "complete",
				},
			});

			// Store real PNG in staging
			const pngBytes = await pngImage(50, 50);
			fakeS3.upload(uploadKey(upload.id), pngBytes, "image/jpeg");

			await expect(importFromUpload(upload.id)).rejects.toThrow(
				"Content type mismatch",
			);

			const updated = await db().upload.findUniqueOrThrow({
				where: { id: upload.id },
			});
			expect(updated.status).toBe("failed");
			expect(updated.error).toBe("Content type mismatch");

			// Staging object deleted
			expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);
		});

		it("imports completed upload, writes original, and deletes staging", async () => {
			const uId = await userId();
			const bytes = await pngImage(80, 60);
			const sha256Hex = createHash("sha256").update(bytes).digest("hex");

			const upload = await db().upload.create({
				data: {
					uploaderId: uId,
					contentType: "image/png",
					size: bytes.byteLength,
					status: "complete",
				},
			});

			fakeS3.upload(uploadKey(upload.id), bytes, "image/png");

			const result = await importFromUpload(upload.id);
			expect(result.memeId).toBeTruthy();

			const meme = await db().meme.findUniqueOrThrow({
				where: { id: result.memeId },
			});
			expect(meme.source).toBe("upload");
			expect(meme.status).toBe("inbox");
			expect(meme.sha256).toBe(sha256Hex);
			expect(meme.width).toBe(80);
			expect(meme.height).toBe(60);

			// Original in S3
			expect(
				fakeS3.objects.has(memeKey(meme.id, "original", "image/png")),
			).toBe(true);

			// Staging object deleted
			expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);

			// Upload updated
			const updated = await db().upload.findUniqueOrThrow({
				where: { id: upload.id },
			});
			expect(updated.status).toBe("imported");
			expect(updated.memeId).toBe(meme.id);

			// Enqueued media.renditions and analysis.meme
			expect(enqueuedJobs.map((j) => j.name)).toEqual([
				"media.renditions",
				"analysis.meme",
			]);
		});

		it("links to existing meme on exact SHA-256 duplicate upload", async () => {
			const uId = await userId();
			const bytes = await pngImage(80, 60);
			const sha256Hex = createHash("sha256").update(bytes).digest("hex");

			const existingMeme = await createMeme({
				sha256: sha256Hex,
			});

			const upload = await db().upload.create({
				data: {
					uploaderId: uId,
					contentType: "image/png",
					size: bytes.byteLength,
					status: "complete",
				},
			});

			fakeS3.upload(uploadKey(upload.id), bytes, "image/png");

			const result = await importFromUpload(upload.id);
			expect(result.memeId).toBe(existingMeme.id);

			// Staging object deleted
			expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);

			const updated = await db().upload.findUniqueOrThrow({
				where: { id: upload.id },
			});
			expect(updated.status).toBe("imported");
			expect(updated.memeId).toBe(existingMeme.id);

			// No new jobs enqueued
			expect(enqueuedJobs).toHaveLength(0);
		});
	});
});
