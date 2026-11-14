import { beforeEach, describe, expect, it } from "vitest";
import { GET as getPostHandler, PATCH as patchPostHandler } from "@/app/api/posts/[id]/route";
import { POST as publishNowHandler } from "@/app/api/posts/[id]/publish-now/route";
import { POST as reorderPostsHandler } from "@/app/api/posts/reorder/route";
import { GET as listPostsHandler, POST as createPostHandler } from "@/app/api/posts/route";
import type { PostDetailDto, PostSummaryDto } from "@/lib/api/types";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme, createPost } from "@/test/helpers/factories";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";

describeWithDb("posts HTTP API", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("POST /api/posts creates a post and returns 201 PostDetail", async () => {
		const meme = await createMeme({
			status: "approved",
			captionDraft: "Default caption draft",
		});

		const req = apiRequest("/api/posts", {
			method: "POST",
			body: { memeIds: [meme.id] },
			user: TEST_USER,
		});

		const res = await createPostHandler(req, {});
		expect(res.status).toBe(201);

		const data = await json<PostDetailDto>(res);
		expect(data.id).toBeDefined();
		expect(data.caption).toBe("Default caption draft");
		expect(data.itemCount).toBe(1);
		expect(data.renderedCaption).toBeDefined();
		expect(data.captionWarnings).toBeDefined();
	});

	it("POST /api/posts rejects unauthenticated request with 401", async () => {
		const req = apiRequest("/api/posts", {
			method: "POST",
			body: { memeIds: ["00000000-0000-0000-0000-000000000000"] },
			user: null,
		});

		const res = await createPostHandler(req, {});
		expect(res.status).toBe(401);
	});

	it("GET /api/posts lists posts with pagination and status filter", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });

		await createPost([m1.id], { status: "draft" });
		await createPost([m2.id], { status: "queued" });

		const req = apiRequest("/api/posts?status=queued", {
			user: TEST_USER,
		});

		const res = await listPostsHandler(req, {});
		expect(res.status).toBe(200);

		const data = await json<{ items: PostSummaryDto[]; nextCursor: string | null }>(
			res,
		);
		expect(data.items).toHaveLength(1);
		expect(data.items[0]?.status).toBe("queued");
	});

	it("GET /api/posts/:id returns PostDetail with renderedCaption and captionWarnings", async () => {
		const meme = await createMeme({
			status: "approved",
			creditText: "artist",
		});
		const post = await createPost([meme.id], { caption: "Nice meme" });

		const req = apiRequest(`/api/posts/${post.id}`, { user: TEST_USER });
		const res = await getPostHandler(req, routeParams({ id: post.id }));
		expect(res.status).toBe(200);

		const data = await json<PostDetailDto>(res);
		expect(data.id).toBe(post.id);
		expect(data.renderedCaption).toContain("Nice meme");
		expect(data.renderedCaption).toContain("📸 artist");
	});

	it("PATCH /api/posts/:id updates post caption and status", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost([meme.id]);

		const req = apiRequest(`/api/posts/${post.id}`, {
			method: "PATCH",
			body: { caption: "New updated caption", status: "queued" },
			user: TEST_USER,
		});

		const res = await patchPostHandler(req, routeParams({ id: post.id }));
		expect(res.status).toBe(200);

		const data = await json<PostDetailDto>(res);
		expect(data.caption).toBe("New updated caption");
		expect(data.status).toBe("queued");
	});

	it("POST /api/posts/:id/publish-now enqueues publish and returns 202", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost([meme.id]);

		const req = apiRequest(`/api/posts/${post.id}/publish-now`, {
			method: "POST",
			user: TEST_USER,
		});

		const res = await publishNowHandler(req, routeParams({ id: post.id }));
		expect(res.status).toBe(202);

		const data = await json<PostDetailDto>(res);
		expect(data.status).toBe("queued");
		expect(data.scheduledAt).toBeDefined();
	});

	it("POST /api/posts/reorder updates queue order and returns 204", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });

		const p1 = await createPost([m1.id], { status: "queued" });
		const p2 = await createPost([m2.id], { status: "queued" });

		const req = apiRequest("/api/posts/reorder", {
			method: "POST",
			body: { ids: [p2.id, p1.id] },
			user: TEST_USER,
		});

		const res = await reorderPostsHandler(req, {});
		expect(res.status).toBe(204);
	});
});
