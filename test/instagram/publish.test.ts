import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { encrypt } from "@/lib/instagram/crypto";
import { publishPost } from "@/lib/instagram/publish";
import { memeKey } from "@/lib/s3";
import { setSettings } from "@/lib/settings";
import { pngImage } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import {
	createInstagramAccount,
	createMeme,
	createPost,
} from "@/test/helpers/factories";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

describeWithDb("instagram publisher state machine", () => {
	const validKey = crypto.randomBytes(32).toString("base64");
	const originalEnv = { ...process.env };
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		process.env.INSTAGRAM_APP_ID = "test_app_id";
		process.env.INSTAGRAM_APP_SECRET = "test_app_secret";
		process.env.TOKEN_ENCRYPTION_KEY = validKey;
		resetEnvCache();
	});

	afterEach(() => {
		fakeS3.restore();
		process.env = { ...originalEnv };
		resetEnvCache();
		vi.restoreAllMocks();
	});

	it("publishes a single image post successfully", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", validKey),
			isDefault: true,
		});

		const meme = await createMeme({
			contentType: "image/png",
			creditText: "photographer",
			hashtags: ["memes"],
		});

		const imgBytes = await pngImage(800, 1000);
		fakeS3.upload(
			memeKey(meme.id, "original", "image/png"),
			imgBytes,
			"image/png",
		);

		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Funny picture",
			accountId: account.id,
		});

		let containerCreated = false;
		let published = false;

		const mockFetch = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("/content_publishing_limit")) {
					return Response.json({
						data: [{ quota_usage: 10, config: { quota_total: 100 } }],
					});
				}
				if (urlStr.includes("/media_publish")) {
					published = true;
					return Response.json({ id: "ig_media_999" });
				}
				if (urlStr.includes("/ig_media_999?fields=permalink")) {
					return Response.json({
						id: "ig_media_999",
						permalink: "https://instagram.com/p/Cxyz",
					});
				}
				if (urlStr.includes("/container_123?fields=status_code")) {
					return Response.json({
						id: "container_123",
						status_code: "FINISHED",
					});
				}
				if (urlStr.includes("/media?fields=id,caption,timestamp,permalink")) {
					return Response.json({ data: [] });
				}
				if (urlStr.endsWith("/media") && init?.method === "POST") {
					containerCreated = true;
					return Response.json({ id: "container_123" });
				}
				return new Response(null, { status: 404 });
			},
		);

		await publishPost(post.id, { fetch: mockFetch as unknown as typeof fetch });

		expect(containerCreated).toBe(true);
		expect(published).toBe(true);

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("published");
		expect(updated.igMediaId).toBe("ig_media_999");
		expect(updated.permalink).toBe("https://instagram.com/p/Cxyz");
		expect(updated.publishedAt).not.toBeNull();
		expect(updated.containerIds).toEqual(["container_123"]);

		// Audit check
		const auditEvent = await db().auditEvent.findFirst({
			where: { action: "post.publish", subjectId: post.id },
		});
		expect(auditEvent).not.toBeNull();
	});

	it("publishes a carousel post with child containers and parent container", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", validKey),
			isDefault: true,
		});

		const meme1 = await createMeme({ contentType: "image/png" });
		const meme2 = await createMeme({ contentType: "image/png" });
		const img1 = await pngImage(800, 1000);
		const img2 = await pngImage(800, 1000);

		fakeS3.upload(
			memeKey(meme1.id, "original", "image/png"),
			img1,
			"image/png",
		);
		fakeS3.upload(
			memeKey(meme2.id, "original", "image/png"),
			img2,
			"image/png",
		);

		const post = await createPost([meme1.id, meme2.id], {
			status: "queued",
			caption: "Double meme",
			accountId: account.id,
		});

		const createdContainers: string[] = [];

		const mockFetch = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("/content_publishing_limit")) {
					return Response.json({
						data: [{ quota_usage: 5, config: { quota_total: 100 } }],
					});
				}
				if (urlStr.includes("/media_publish")) {
					return Response.json({ id: "ig_media_carousel_1" });
				}
				if (urlStr.includes("/ig_media_carousel_1?fields=permalink")) {
					return Response.json({
						permalink: "https://instagram.com/p/carousel1",
					});
				}
				if (urlStr.includes("?fields=status_code")) {
					return Response.json({ status_code: "FINISHED" });
				}
				if (urlStr.includes("/media?fields=id,caption,timestamp,permalink")) {
					return Response.json({ data: [] });
				}
				if (urlStr.endsWith("/media") && init?.method === "POST") {
					const id = `container_${createdContainers.length + 1}`;
					createdContainers.push(id);
					return Response.json({ id });
				}
				return new Response(null, { status: 404 });
			},
		);

		await publishPost(post.id, { fetch: mockFetch as unknown as typeof fetch });

		// 2 child containers + 1 carousel parent container = 3 containers
		expect(createdContainers).toHaveLength(3);

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("published");
		expect(updated.igMediaId).toBe("ig_media_carousel_1");
		expect(updated.containerIds).toEqual([
			"container_1",
			"container_2",
			"container_3",
		]);
	});

	it("reuses unexpired container on retry after timeout", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", validKey),
			isDefault: true,
		});

		const meme = await createMeme({ contentType: "image/png" });
		const img = await pngImage(800, 1000);
		fakeS3.upload(memeKey(meme.id, "original", "image/png"), img, "image/png");

		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Timeout meme",
			accountId: account.id,
		});

		let creationCalls = 0;

		// First run: container is stuck IN_PROGRESS
		const mockFetch1 = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("/content_publishing_limit")) {
					return Response.json({
						data: [{ quota_usage: 0, config: { quota_total: 100 } }],
					});
				}
				if (urlStr.endsWith("/media") && init?.method === "POST") {
					creationCalls++;
					return Response.json({ id: "c_stuck" });
				}
				if (urlStr.includes("/c_stuck?fields=status_code")) {
					return Response.json({ id: "c_stuck", status_code: "IN_PROGRESS" });
				}
				return new Response(null, { status: 404 });
			},
		);

		// Pass a no-op sleep to run through 24 iterations quickly
		await publishPost(post.id, {
			fetch: mockFetch1 as unknown as typeof fetch,
			sleep: async () => {},
		});

		// Check post was queued back with attempts = 1 and containerIds saved
		const afterFirstRun = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(afterFirstRun.status).toBe("queued");
		expect(afterFirstRun.attempts).toBe(1);
		expect(afterFirstRun.containerIds).toEqual(["c_stuck"]);
		expect(creationCalls).toBe(1);

		// Second run: now container is FINISHED; it should reuse c_stuck without calling createImageContainer
		const mockFetch2 = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("/content_publishing_limit")) {
					return Response.json({
						data: [{ quota_usage: 0, config: { quota_total: 100 } }],
					});
				}
				if (urlStr.includes("/media_publish")) {
					return Response.json({ id: "ig_pub_reused" });
				}
				if (urlStr.includes("/ig_pub_reused?fields=permalink")) {
					return Response.json({ permalink: "https://instagram.com/p/reused" });
				}
				if (urlStr.includes("/c_stuck?fields=status_code")) {
					return Response.json({ id: "c_stuck", status_code: "FINISHED" });
				}
				if (urlStr.includes("/media?fields=id,caption,timestamp,permalink")) {
					return Response.json({ data: [] });
				}
				if (urlStr.endsWith("/media") && init?.method === "POST") {
					creationCalls++;
					return Response.json({ id: "c_unexpected" });
				}
				return new Response(null, { status: 404 });
			},
		);

		await publishPost(post.id, {
			fetch: mockFetch2 as unknown as typeof fetch,
			sleep: async () => {},
		});

		// Creation calls should still be 1 (reused c_stuck)
		expect(creationCalls).toBe(1);

		const afterSecondRun = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(afterSecondRun.status).toBe("published");
		expect(afterSecondRun.igMediaId).toBe("ig_pub_reused");
	});

	it("on a retry, guards against double-posting by checking recentMedia before calling publish", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", validKey),
			isDefault: true,
		});

		const meme = await createMeme({ contentType: "image/png" });
		const img = await pngImage(800, 1000);
		fakeS3.upload(memeKey(meme.id, "original", "image/png"), img, "image/png");

		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Double post prevention test",
			accountId: account.id,
			// A previous attempt already ran (and may have reached media_publish)
			attempts: 1,
		});

		let publishEndpointCalled = false;
		const fixedNow = new Date("2026-11-14T12:00:00Z");

		const mockFetch = vi.fn(async (url: string | URL | Request) => {
			const urlStr = String(url);
			if (urlStr.includes("/content_publishing_limit")) {
				return Response.json({
					data: [{ quota_usage: 0, config: { quota_total: 100 } }],
				});
			}
			if (urlStr.includes("/media_publish")) {
				publishEndpointCalled = true;
				return Response.json({ id: "wrong_second_publish" });
			}
			if (urlStr.includes("/container_double_check?fields=status_code")) {
				return Response.json({
					id: "container_double_check",
					status_code: "FINISHED",
				});
			}
			if (urlStr.includes("/media?fields=id,caption,timestamp,permalink")) {
				// Simulates that Meta already published this post earlier
				return Response.json({
					data: [
						{
							id: "already_published_id",
							caption:
								"Double post prevention test\n\nCreator unknown — DM for credit/removal",
							timestamp: new Date("2026-11-14T12:00:05Z").toISOString(),
							permalink: "https://instagram.com/p/already_there",
						},
					],
				});
			}
			if (urlStr.endsWith("/media")) {
				return Response.json({ id: "container_double_check" });
			}
			return new Response(null, { status: 404 });
		});

		await publishPost(post.id, {
			fetch: mockFetch as unknown as typeof fetch,
			now: () => fixedNow,
		});

		// Publish endpoint should NOT have been called because it matched recentMedia!
		expect(publishEndpointCalled).toBe(false);

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("published");
		expect(updated.igMediaId).toBe("already_published_id");
		expect(updated.permalink).toBe("https://instagram.com/p/already_there");
	});

	it("defers to next slot when rate limit used >= 95", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", validKey),
			isDefault: true,
		});

		const meme = await createMeme({ contentType: "image/png" });
		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Rate limited meme",
			accountId: account.id,
		});

		const now = new Date("2026-11-14T15:00:00Z");

		const mockFetch = vi.fn(async (url: string | URL | Request) => {
			const urlStr = String(url);
			if (urlStr.includes("/content_publishing_limit")) {
				return Response.json({
					data: [{ quota_usage: 96, config: { quota_total: 100 } }],
				});
			}
			return new Response(null, { status: 404 });
		});

		await publishPost(post.id, {
			fetch: mockFetch as unknown as typeof fetch,
			now: () => now,
		});

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("queued");
		// Scheduled 1h later
		expect(updated.scheduledAt?.toISOString()).toBe(
			new Date("2026-11-14T16:00:00Z").toISOString(),
		);
	});

	it("skips and clears scheduledAt when publishing is paused in settings", async () => {
		await setSettings({ "publishing.paused": true }, null);

		const meme = await createMeme({ contentType: "image/png" });
		const post = await createPost([meme.id], {
			status: "queued",
			scheduledAt: new Date("2026-11-14T10:00:00Z"),
			caption: "Paused post",
		});

		await publishPost(post.id);

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("queued");
		expect(updated.scheduledAt).toBeNull();
	});

	it("fails immediately without retry on token expiry error (code 190)", async () => {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("expired_token", validKey),
			isDefault: true,
		});

		const meme = await createMeme({ contentType: "image/png" });
		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Expired token post",
			accountId: account.id,
		});

		const mockFetch = vi.fn(async () => {
			return Response.json(
				{
					error: {
						message: "Error validating access token: Session has expired",
						code: 190,
						error_subcode: 463,
					},
				},
				{ status: 400 },
			);
		});

		await publishPost(post.id, { fetch: mockFetch as unknown as typeof fetch });

		const updated = await db().post.findUniqueOrThrow({
			where: { id: post.id },
		});
		expect(updated.status).toBe("failed");
		expect(updated.error).toContain("Instagram token expired");

		const auditFail = await db().auditEvent.findFirst({
			where: { action: "post.fail", subjectId: post.id },
		});
		expect(auditFail).not.toBeNull();
	});
});
