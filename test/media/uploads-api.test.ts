import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as handleCompleteUpload } from "@/app/api/uploads/[id]/complete/route";
import { GET as handleGetUpload } from "@/app/api/uploads/[id]/route";
import { POST as handleCreateUpload } from "@/app/api/uploads/route";
import type { UploadCreatedDto, UploadDto } from "@/lib/api/types";
import { db } from "@/lib/db";
import { uploadKey } from "@/lib/s3";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { ADMIN_USER, OTHER_USER } from "@/test/helpers/users";

const enqueuedJobs: { name: string; data: unknown }[] = [];

vi.mock("@/lib/jobs/queue", () => ({
	enqueue: vi.fn(async (job: { name: string }, data: unknown) => {
		enqueuedJobs.push({ name: job.name, data });
		return "job-id";
	}),
}));

describeWithDb("uploads API", () => {
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

	describe("POST /api/uploads", () => {
		it("requires authentication (401)", async () => {
			const req = apiRequest("/api/uploads", {
				method: "POST",
				user: null,
				body: { contentType: "image/png", size: 1000 },
			});
			const res = await handleCreateUpload(req, {});
			expect(res.status).toBe(401);
		});

		it("rejects unsupported format with 422 unsupported_format", async () => {
			const req = apiRequest("/api/uploads", {
				method: "POST",
				body: { contentType: "image/heic", size: 1000 },
			});
			const res = await handleCreateUpload(req, {});
			expect(res.status).toBe(422);
			const body = await json<{ error: string }>(res);
			expect(body.error).toBe("unsupported_format");
		});

		it("rejects file larger than 25 MiB with 422 too_large", async () => {
			const req = apiRequest("/api/uploads", {
				method: "POST",
				body: {
					contentType: "image/png",
					size: 25 * 1024 * 1024 + 1,
				},
			});
			const res = await handleCreateUpload(req, {});
			expect(res.status).toBe(422);
			const body = await json<{ error: string }>(res);
			expect(body.error).toBe("too_large");
		});

		it("creates upload record and returns presigned PUT URL (201)", async () => {
			const req = apiRequest("/api/uploads", {
				method: "POST",
				body: { contentType: "image/jpeg", size: 5000 },
			});
			const res = await handleCreateUpload(req, {});
			expect(res.status).toBe(201);
			const body = await json<UploadCreatedDto>(res);
			expect(body.upload.id).toBeTruthy();
			expect(body.upload.status).toBe("pending");
			expect(body.upload.contentType).toBe("image/jpeg");
			expect(body.upload.size).toBe(5000);
			expect(body.uploadUrl).toContain("https://");
			expect(body.uploadHeaders).toEqual({ "Content-Type": "image/jpeg" });

			const inDb = await db().upload.findUnique({
				where: { id: body.upload.id },
			});
			expect(inDb).toBeDefined();
			expect(inDb?.status).toBe("pending");
		});
	});

	describe("POST /api/uploads/[id]/complete", () => {
		it("requires authentication (401)", async () => {
			const req = apiRequest("/api/uploads/123/complete", {
				method: "POST",
				user: null,
			});
			const res = await handleCompleteUpload(req, routeParams({ id: "123" }));
			expect(res.status).toBe(401);
		});

		it("returns 404 when upload does not exist", async () => {
			const req = apiRequest(
				"/api/uploads/00000000-0000-0000-0000-000000000000/complete",
				{
					method: "POST",
				},
			);
			const res = await handleCompleteUpload(
				req,
				routeParams({ id: "00000000-0000-0000-0000-000000000000" }),
			);
			expect(res.status).toBe(404);
		});

		it("returns 403 when called by another non-admin user", async () => {
			// Create upload as TEST_USER
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				user: TEST_USER,
				body: { contentType: "image/png", size: 500 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			// Complete as OTHER_USER
			const req = apiRequest(`/api/uploads/${upload.id}/complete`, {
				method: "POST",
				user: OTHER_USER,
			});
			const res = await handleCompleteUpload(
				req,
				routeParams({ id: upload.id }),
			);
			expect(res.status).toBe(403);
		});

		it("returns 409 conflict when S3 object does not exist or size mismatches", async () => {
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				body: { contentType: "image/png", size: 500 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			// Object not in S3 yet
			const req = apiRequest(`/api/uploads/${upload.id}/complete`, {
				method: "POST",
			});
			const res = await handleCompleteUpload(
				req,
				routeParams({ id: upload.id }),
			);
			expect(res.status).toBe(409);

			// Object in S3 with wrong size
			fakeS3.upload(
				uploadKey(upload.id),
				new Uint8Array([1, 2, 3]),
				"image/png",
			);
			const req2 = apiRequest(`/api/uploads/${upload.id}/complete`, {
				method: "POST",
			});
			const res2 = await handleCompleteUpload(
				req2,
				routeParams({ id: upload.id }),
			);
			expect(res2.status).toBe(409);
		});

		it("completes upload when size matches and enqueues import.upload", async () => {
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				body: { contentType: "image/png", size: 4 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			// Upload 4 bytes to S3
			fakeS3.upload(
				uploadKey(upload.id),
				new Uint8Array([1, 2, 3, 4]),
				"image/png",
			);

			const req = apiRequest(`/api/uploads/${upload.id}/complete`, {
				method: "POST",
			});
			const res = await handleCompleteUpload(
				req,
				routeParams({ id: upload.id }),
			);
			expect(res.status).toBe(200);
			const completed = await json<UploadDto>(res);
			expect(completed.status).toBe("complete");

			// import.upload enqueued
			expect(enqueuedJobs).toEqual([
				{ name: "import.upload", data: { uploadId: upload.id } },
			]);

			// Idempotent: calling complete again returns complete status
			const resAgain = await handleCompleteUpload(
				req,
				routeParams({ id: upload.id }),
			);
			expect(resAgain.status).toBe(200);
		});

		it("allows admin to complete any upload", async () => {
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				user: TEST_USER,
				body: { contentType: "image/png", size: 4 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			fakeS3.upload(
				uploadKey(upload.id),
				new Uint8Array([1, 2, 3, 4]),
				"image/png",
			);

			const req = apiRequest(`/api/uploads/${upload.id}/complete`, {
				method: "POST",
				user: ADMIN_USER,
			});
			const res = await handleCompleteUpload(
				req,
				routeParams({ id: upload.id }),
			);
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/uploads/[id]", () => {
		it("returns upload details for the uploader", async () => {
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				user: TEST_USER,
				body: { contentType: "image/png", size: 4 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			const getReq = apiRequest(`/api/uploads/${upload.id}`, {
				method: "GET",
				user: TEST_USER,
			});
			const getRes = await handleGetUpload(
				getReq,
				routeParams({ id: upload.id }),
			);
			expect(getRes.status).toBe(200);
			const got = await json<UploadDto>(getRes);
			expect(got.id).toBe(upload.id);
		});

		it("returns 403 for unauthorized viewer", async () => {
			const createReq = apiRequest("/api/uploads", {
				method: "POST",
				user: TEST_USER,
				body: { contentType: "image/png", size: 4 },
			});
			const createRes = await handleCreateUpload(createReq, {});
			const { upload } = await json<UploadCreatedDto>(createRes);

			const getReq = apiRequest(`/api/uploads/${upload.id}`, {
				method: "GET",
				user: OTHER_USER,
			});
			const getRes = await handleGetUpload(
				getReq,
				routeParams({ id: upload.id }),
			);
			expect(getRes.status).toBe(403);
		});
	});
});
