import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { encrypt } from "@/lib/instagram/crypto";
import { PUBLISHING_STALE_MS, publishPost } from "@/lib/instagram/publish";
import { instagramKey, memeKey } from "@/lib/s3";
import { pngImage } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import {
	createInstagramAccount,
	createMeme,
	createPost,
} from "@/test/helpers/factories";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

const CAPTION_TEXT = "Same words\n\nCreator unknown — DM for credit/removal";

type Calls = { create: number; publish: number };

/** A stub Graph API; `recent` is what the account's recent media returns. */
function graphStub(opts: {
	recent?: unknown[];
	used?: number;
	containerStatus?: string;
	publishError?: { message: string; code: number };
}) {
	const calls: Calls = { create: 0, publish: 0 };
	const fetchFn = vi.fn(
		async (url: string | URL | Request, init?: RequestInit) => {
			const u = String(url);
			if (u.includes("/content_publishing_limit")) {
				return Response.json({
					data: [{ quota_usage: opts.used ?? 0, config: { quota_total: 100 } }],
				});
			}
			if (u.includes("/media_publish")) {
				calls.publish++;
				if (opts.publishError) {
					return Response.json({ error: opts.publishError }, { status: 400 });
				}
				return Response.json({ id: "ig_new" });
			}
			if (u.includes("/ig_new?fields=permalink")) {
				return Response.json({ permalink: "https://instagram.com/p/new" });
			}
			if (u.includes("?fields=status_code")) {
				return Response.json({
					id: "c1",
					status_code: opts.containerStatus ?? "FINISHED",
				});
			}
			if (u.includes("/media?fields=id,caption,timestamp,permalink")) {
				return Response.json({ data: opts.recent ?? [] });
			}
			if (u.endsWith("/media") && init?.method === "POST") {
				calls.create++;
				return Response.json({ id: "c1" });
			}
			return new Response(null, { status: 404 });
		},
	);
	return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describeWithDb("instagram publisher: double and lost post safety", () => {
	const key = crypto.randomBytes(32).toString("base64");
	const originalEnv = { ...process.env };
	let fakeS3: FakeS3;

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		process.env.TOKEN_ENCRYPTION_KEY = key;
		resetEnvCache();
	});

	afterEach(() => {
		fakeS3.restore();
		process.env = { ...originalEnv };
		resetEnvCache();
	});

	async function setup(
		postOverrides: Record<string, unknown> = {},
		accountOverrides: Record<string, unknown> = {},
	) {
		const account = await createInstagramAccount({
			igUserId: "ig_user_1",
			accessTokenEnc: encrypt("valid_token", key),
			isDefault: true,
			...accountOverrides,
		});
		const meme = await createMeme({ contentType: "image/png" });
		fakeS3.upload(
			memeKey(meme.id, "original", "image/png"),
			await pngImage(800, 1000),
			"image/png",
		);
		const post = await createPost([meme.id], {
			status: "queued",
			caption: "Same words",
			accountId: account.id,
			...postOverrides,
		});
		return { account, meme, post };
	}

	it("a first attempt never takes a lookalike post for itself", async () => {
		const { post } = await setup();
		const { fetchFn, calls } = graphStub({
			recent: [
				{
					id: "someone_elses",
					caption: CAPTION_TEXT,
					timestamp: new Date(Date.now() + 1000).toISOString(),
				},
			],
		});

		await publishPost(post.id, { fetch: fetchFn });

		expect(calls.publish).toBe(1);
		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.status).toBe("published");
		expect(row.igMediaId).toBe("ig_new");
	});

	it("a retry ignores media already claimed by another published post", async () => {
		const { post } = await setup({ attempts: 1 });
		const other = await createMeme({ contentType: "image/png" });
		await createPost([other.id], {
			status: "published",
			igMediaId: "claimed_media",
		});
		const { fetchFn, calls } = graphStub({
			recent: [
				{
					id: "claimed_media",
					caption: CAPTION_TEXT,
					timestamp: new Date(Date.now() + 1000).toISOString(),
				},
			],
		});

		await publishPost(post.id, { fetch: fetchFn });

		expect(calls.publish).toBe(1);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } })).igMediaId,
		).toBe("ig_new");
	});

	it("a retry whose container is already PUBLISHED adopts the live media instead of failing", async () => {
		const { post } = await setup({
			attempts: 1,
			containerIds: ["c1"],
			containerAt: new Date(Date.now() - 60_000),
		});
		const { fetchFn, calls } = graphStub({
			containerStatus: "PUBLISHED",
			recent: [
				{
					id: "live_media",
					caption: "caption as instagram stored it, edited",
					timestamp: new Date().toISOString(),
					permalink: "https://instagram.com/p/live",
				},
			],
		});

		await publishPost(post.id, { fetch: fetchFn });

		expect(calls.publish).toBe(0);
		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.status).toBe("published");
		expect(row.igMediaId).toBe("live_media");
	});

	it("rate-limit deferral does not use up an attempt", async () => {
		const { post } = await setup({ attempts: 1 });
		const now = new Date("2026-11-14T15:00:00Z");
		const { fetchFn } = graphStub({ used: 97 });

		await publishPost(post.id, { fetch: fetchFn, now: () => now });

		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.status).toBe("queued");
		expect(row.attempts).toBe(1);
		expect(row.scheduledAt?.toISOString()).toBe("2026-11-14T16:00:00.000Z");
	});

	it("a rate-limit error from Graph defers instead of failing the post", async () => {
		const { post } = await setup({ attempts: 2 });
		const { fetchFn } = graphStub({
			publishError: { message: "Application request limit reached", code: 4 },
		});

		await publishPost(post.id, { fetch: fetchFn });

		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.status).toBe("queued");
		expect(row.attempts).toBe(2);
		expect(row.scheduledAt).not.toBeNull();
	});

	it("two concurrent runs publish exactly once", async () => {
		const { post } = await setup();
		const { fetchFn, calls } = graphStub({});

		await Promise.all([
			publishPost(post.id, { fetch: fetchFn }),
			publishPost(post.id, { fetch: fetchFn }),
		]);

		expect(calls.publish).toBe(1);
		expect(calls.create).toBe(1);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } })).status,
		).toBe("published");
	});

	it("reclaims a post a crashed worker left in publishing, but not a fresh one", async () => {
		const { post } = await setup({ status: "publishing", attempts: 1 });
		const { fetchFn, calls } = graphStub({});

		// Fresh publishing: another worker is on it
		await publishPost(post.id, { fetch: fetchFn });
		expect(calls.publish).toBe(0);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } })).status,
		).toBe("publishing");

		// Stale publishing: the worker died
		await db().post.update({
			where: { id: post.id },
			data: { updatedAt: new Date(Date.now() - PUBLISHING_STALE_MS - 1000) },
		});
		await publishPost(post.id, { fetch: fetchFn });
		expect(calls.publish).toBe(1);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } })).status,
		).toBe("published");
	});

	it("renders fresh renditions before creating containers", async () => {
		const { post } = await setup();
		const stale = Buffer.from("stale rendition from an earlier version");
		fakeS3.upload(instagramKey(post.id, 0), stale);
		const { fetchFn } = graphStub({});

		await publishPost(post.id, { fetch: fetchFn });

		const stored = fakeS3.objects.get(instagramKey(post.id, 0));
		expect(stored).toBeDefined();
		expect(Buffer.from(stored?.body ?? []).equals(stale)).toBe(false);
		expect(stored?.contentType).toBe("image/jpeg");
	});

	it("fails an expired token without calling Instagram", async () => {
		const { post } = await setup(
			{},
			{ tokenExpiresAt: new Date(Date.now() - 1000) },
		);
		const { fetchFn } = graphStub({});

		await publishPost(post.id, { fetch: fetchFn });

		expect(fetchFn).not.toHaveBeenCalled();
		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.status).toBe("failed");
		expect(row.error).toContain("token expired");
	});
});
