import { afterEach, beforeEach, expect, it } from "vitest";
import { GET as handleGetMedia } from "@/app/api/memes/[id]/media/[variant]/route";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { apiRequest, routeParams } from "@/test/helpers/http";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

describeWithDb("media route (GET /memes/[id]/media/[variant])", () => {
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
	});

	afterEach(() => {
		fakeS3.restore();
	});

	it("requires authentication (401)", async () => {
		const req = apiRequest("/api/memes/123/media/original", {
			user: null,
		});
		const res = await handleGetMedia(
			req,
			routeParams({ id: "123", variant: "original" }),
		);
		expect(res.status).toBe(401);
	});

	it("returns 400 for unknown variant", async () => {
		const meme = await createMeme();
		const req = apiRequest(`/api/memes/${meme.id}/media/invalid_variant`);
		const res = await handleGetMedia(
			req,
			routeParams({ id: meme.id, variant: "invalid_variant" }),
		);
		expect(res.status).toBe(400);
	});

	it("returns 404 when meme does not exist", async () => {
		const req = apiRequest(
			"/api/memes/00000000-0000-0000-0000-000000000000/media/original",
		);
		const res = await handleGetMedia(
			req,
			routeParams({
				id: "00000000-0000-0000-0000-000000000000",
				variant: "original",
			}),
		);
		expect(res.status).toBe(404);
	});

	it("returns 404 for display and thumb before renditionsReady", async () => {
		const meme = await createMeme({ renditionsReady: false });

		const displayReq = apiRequest(`/api/memes/${meme.id}/media/display`);
		const displayRes = await handleGetMedia(
			displayReq,
			routeParams({ id: meme.id, variant: "display" }),
		);
		expect(displayRes.status).toBe(404);

		const thumbReq = apiRequest(`/api/memes/${meme.id}/media/thumb`);
		const thumbRes = await handleGetMedia(
			thumbReq,
			routeParams({ id: meme.id, variant: "thumb" }),
		);
		expect(thumbRes.status).toBe(404);

		// But original is available before renditionsReady
		const origReq = apiRequest(`/api/memes/${meme.id}/media/original`);
		const origRes = await handleGetMedia(
			origReq,
			routeParams({ id: meme.id, variant: "original" }),
		);
		expect(origRes.status).toBe(302);
		expect(origRes.headers.get("Location")).toContain("https://");
		expect(origRes.headers.get("Cache-Control")).toBe("private, max-age=300");
	});

	it("returns 302 with presigned URL for display and thumb once renditionsReady", async () => {
		const meme = await createMeme({ renditionsReady: true });

		const displayReq = apiRequest(`/api/memes/${meme.id}/media/display`);
		const displayRes = await handleGetMedia(
			displayReq,
			routeParams({ id: meme.id, variant: "display" }),
		);
		expect(displayRes.status).toBe(302);
		expect(displayRes.headers.get("Location")).toContain("https://");
		expect(displayRes.headers.get("Cache-Control")).toBe(
			"private, max-age=300",
		);

		const thumbReq = apiRequest(`/api/memes/${meme.id}/media/thumb`);
		const thumbRes = await handleGetMedia(
			thumbReq,
			routeParams({ id: meme.id, variant: "thumb" }),
		);
		expect(thumbRes.status).toBe(302);
		expect(thumbRes.headers.get("Location")).toContain("https://");
		expect(thumbRes.headers.get("Cache-Control")).toBe("private, max-age=300");
	});
});
