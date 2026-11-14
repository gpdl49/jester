import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DELETE as deleteDetailRoute,
	GET as getDetailRoute,
	PATCH as patchDetailRoute,
} from "@/app/api/memes/[id]/route";
import { POST as bulkRoute } from "@/app/api/memes/bulk/route";
import { GET as listRoute } from "@/app/api/memes/route";
import type { MemeDetailDto, MemeSummaryDto, Paged } from "@/lib/api/types";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { ADMIN_USER } from "@/test/helpers/users";

describeWithDb("memes API routes", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
	});

	afterEach(() => {
		fakeS3.restore();
	});

	describe("GET /api/memes", () => {
		it("401 without auth", async () => {
			const req = apiRequest("/api/memes", { user: null });
			const res = await listRoute(req, undefined as never);
			expect(res.status).toBe(401);
		});

		it("403 without REQUIRED_GROUP (memes)", async () => {
			const req = apiRequest("/api/memes", {
				user: { ...TEST_USER, groups: ["other-group"] },
			});
			const res = await listRoute(req, undefined as never);
			expect(res.status).toBe(403);
		});

		it("returns paged items for valid request", async () => {
			await createMeme({ status: "inbox" });
			await createMeme({ status: "approved" });

			const req = apiRequest("/api/memes?limit=10");
			const res = await listRoute(req, undefined as never);
			expect(res.status).toBe(200);

			const body = await json<Paged<MemeSummaryDto>>(res);
			expect(body.items).toHaveLength(2);
			expect(body.nextCursor).toBeNull();
		});

		it("400 for invalid query parameters", async () => {
			const req = apiRequest("/api/memes?sort=relevance"); // relevance requires q
			const res = await listRoute(req, undefined as never);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/memes/[id]", () => {
		it("returns detail for existing meme", async () => {
			const meme = await createMeme({ description: "cool meme" });
			const req = apiRequest(`/api/memes/${meme.id}`);
			const res = await getDetailRoute(req, routeParams({ id: meme.id }));
			expect(res.status).toBe(200);

			const body = await json<MemeDetailDto>(res);
			expect(body.id).toBe(meme.id);
			expect(body.description).toBe("cool meme");
		});

		it("404 for non-existent meme", async () => {
			const req = apiRequest("/api/memes/00000000-0000-0000-0000-000000000099");
			const res = await getDetailRoute(
				req,
				routeParams({ id: "00000000-0000-0000-0000-000000000099" }),
			);
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/memes/[id]", () => {
		it("updates meme and returns updated detail", async () => {
			const meme = await createMeme({ status: "inbox" });
			const req = apiRequest(`/api/memes/${meme.id}`, {
				method: "PATCH",
				body: { status: "approved", rating: 4, notes: "Approved by me" },
			});
			const res = await patchDetailRoute(req, routeParams({ id: meme.id }));
			expect(res.status).toBe(200);

			const body = await json<MemeDetailDto>(res);
			expect(body.status).toBe("approved");
			expect(body.rating).toBe(4);
			expect(body.notes).toBe("Approved by me");
		});

		it("422 when setting duplicateOfId to own id", async () => {
			const meme = await createMeme({});
			const req = apiRequest(`/api/memes/${meme.id}`, {
				method: "PATCH",
				body: { duplicateOfId: meme.id },
			});
			const res = await patchDetailRoute(req, routeParams({ id: meme.id }));
			expect(res.status).toBe(422);
		});
	});

	describe("POST /api/memes/bulk", () => {
		it("performs bulk approve", async () => {
			const m1 = await createMeme({ status: "inbox" });
			const m2 = await createMeme({ status: "inbox" });

			const req = apiRequest("/api/memes/bulk", {
				method: "POST",
				body: { ids: [m1.id, m2.id], action: "approve" },
			});
			const res = await bulkRoute(req, undefined as never);
			expect(res.status).toBe(200);

			const body = await json<{ updated: number }>(res);
			expect(body.updated).toBe(2);
		});

		it("400 for empty ids list or invalid action", async () => {
			const req = apiRequest("/api/memes/bulk", {
				method: "POST",
				body: { ids: [], action: "approve" },
			});
			const res = await bulkRoute(req, undefined as never);
			expect(res.status).toBe(400);
		});
	});

	describe("DELETE /api/memes/[id]", () => {
		it("403 for non-admin", async () => {
			const meme = await createMeme({});
			const req = apiRequest(`/api/memes/${meme.id}`, {
				method: "DELETE",
				user: TEST_USER,
			});
			const res = await deleteDetailRoute(req, routeParams({ id: meme.id }));
			expect(res.status).toBe(403);
		});

		it("204 for admin", async () => {
			const meme = await createMeme({});
			const req = apiRequest(`/api/memes/${meme.id}`, {
				method: "DELETE",
				user: ADMIN_USER,
			});
			const res = await deleteDetailRoute(req, routeParams({ id: meme.id }));
			expect(res.status).toBe(204);

			const check = await db().meme.findUnique({ where: { id: meme.id } });
			expect(check).toBeNull();
		});
	});
});
