import { afterEach, beforeEach, expect, it } from "vitest";
import { GET as handleGetMedia } from "@/app/api/memes/[id]/media/[variant]/route";
import { POST as handleCompleteUpload } from "@/app/api/uploads/[id]/complete/route";
import { POST as handleCreateUpload } from "@/app/api/uploads/route";
import type { UploadCreatedDto, UploadDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { importFromUpload } from "@/lib/media/import";
import { generateRenditions } from "@/lib/media/renditions";
import { memeKey, uploadKey } from "@/lib/s3";
import { pngImage } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

describeWithDb("upload end-to-end flow", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
	});

	afterEach(() => {
		fakeS3.restore();
	});

	it("executes the entire upload lifecycle from presign to renditions and media serving", async () => {
		const originalPng = await pngImage(800, 600);

		// 1. Request presigned upload URL
		const createReq = apiRequest("/api/uploads", {
			method: "POST",
			user: TEST_USER,
			body: {
				contentType: "image/png",
				size: originalPng.byteLength,
			},
		});
		const createRes = await handleCreateUpload(createReq, {});
		expect(createRes.status).toBe(201);
		const { upload, uploadUrl, uploadHeaders } =
			await json<UploadCreatedDto>(createRes);
		expect(upload.status).toBe("pending");
		expect(uploadUrl).toContain("https://");
		expect(uploadHeaders["Content-Type"]).toBe("image/png");

		// 2. Simulate browser uploading directly to S3 presigned URL
		fakeS3.upload(uploadKey(upload.id), originalPng, "image/png");

		// 3. Complete the upload
		const completeReq = apiRequest(`/api/uploads/${upload.id}/complete`, {
			method: "POST",
			user: TEST_USER,
		});
		const completeRes = await handleCompleteUpload(
			completeReq,
			routeParams({ id: upload.id }),
		);
		expect(completeRes.status).toBe(200);
		const completedUpload = await json<UploadDto>(completeRes);
		expect(completedUpload.status).toBe("complete");

		// 4. Job runner processes import.upload
		const { memeId } = await importFromUpload(upload.id);
		expect(memeId).toBeTruthy();

		// Verify staging object was removed and original object created
		expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);
		expect(fakeS3.objects.has(memeKey(memeId, "original", "image/png"))).toBe(
			true,
		);

		// Verify upload record updated in DB
		const dbUpload = await db().upload.findUniqueOrThrow({
			where: { id: upload.id },
		});
		expect(dbUpload.status).toBe("imported");
		expect(dbUpload.memeId).toBe(memeId);

		// Verify meme record in DB
		const dbMeme = await db().meme.findUniqueOrThrow({
			where: { id: memeId },
		});
		expect(dbMeme.source).toBe("upload");
		expect(dbMeme.status).toBe("inbox");
		expect(dbMeme.renditionsReady).toBe(false);

		// Media route before renditions are ready
		const preDisplayReq = apiRequest(`/api/memes/${memeId}/media/display`);
		const preDisplayRes = await handleGetMedia(
			preDisplayReq,
			routeParams({ id: memeId, variant: "display" }),
		);
		expect(preDisplayRes.status).toBe(404);

		// Original media route is available immediately
		const origReq = apiRequest(`/api/memes/${memeId}/media/original`);
		const origRes = await handleGetMedia(
			origReq,
			routeParams({ id: memeId, variant: "original" }),
		);
		expect(origRes.status).toBe(302);
		expect(origRes.headers.get("Location")).toContain("https://");
		expect(origRes.headers.get("Cache-Control")).toBe("private, max-age=300");

		// 5. Job runner processes media.renditions
		await generateRenditions(memeId);

		const updatedMeme = await db().meme.findUniqueOrThrow({
			where: { id: memeId },
		});
		expect(updatedMeme.renditionsReady).toBe(true);
		expect(updatedMeme.dhash).toMatch(/^[0-9a-f]{16}$/);
		expect(updatedMeme.blurhash).toBeTruthy();

		// Display and thumb objects exist in S3
		expect(fakeS3.objects.has(memeKey(memeId, "display"))).toBe(true);
		expect(fakeS3.objects.has(memeKey(memeId, "thumb"))).toBe(true);

		// Media route now serves display and thumb
		const displayReq = apiRequest(`/api/memes/${memeId}/media/display`);
		const displayRes = await handleGetMedia(
			displayReq,
			routeParams({ id: memeId, variant: "display" }),
		);
		expect(displayRes.status).toBe(302);
		expect(displayRes.headers.get("Location")).toContain("https://");
		expect(displayRes.headers.get("Cache-Control")).toBe(
			"private, max-age=300",
		);

		const thumbReq = apiRequest(`/api/memes/${memeId}/media/thumb`);
		const thumbRes = await handleGetMedia(
			thumbReq,
			routeParams({ id: memeId, variant: "thumb" }),
		);
		expect(thumbRes.status).toBe(302);
		expect(thumbRes.headers.get("Location")).toContain("https://");
		expect(thumbRes.headers.get("Cache-Control")).toBe("private, max-age=300");
	});
});
