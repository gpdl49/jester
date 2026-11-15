import { describe, expect, it, vi } from "vitest";
import { createGraphClient, GraphError } from "./graph";

type Call = { url: URL; init: RequestInit; body: URLSearchParams };

function stub(responses: unknown[] | unknown, status = 200) {
	const queue = Array.isArray(responses) ? [...responses] : [responses];
	const calls: Call[] = [];
	const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({
			url: new URL(String(url)),
			init: init ?? {},
			body: new URLSearchParams(String(init?.body ?? "")),
		});
		const next = queue.length > 1 ? queue.shift() : queue[0];
		return Response.json(next, { status });
	});
	return { fetch: fn as unknown as typeof fetch, calls };
}

const V = "v27.0";

describe("instagram graph client (Unified Login)", () => {
	it("exchanges the login code on graph.facebook.com", async () => {
		const s = stub({ access_token: "SUAT_1", token_type: "bearer" });
		const res = await createGraphClient({ fetch: s.fetch }).exchangeCode({
			clientId: "meta_app",
			clientSecret: "meta_secret",
			code: "the_code",
		});
		expect(res).toEqual({ accessToken: "SUAT_1", expiresIn: null });
		const c = s.calls[0];
		expect(c?.init.method).toBe("GET");
		expect(`${c?.url.origin}${c?.url.pathname}`).toBe(
			`https://graph.facebook.com/${V}/oauth/access_token`,
		);
		expect(Object.fromEntries(c?.url.searchParams ?? [])).toEqual({
			client_id: "meta_app",
			client_secret: "meta_secret",
			code: "the_code",
		});
	});

	it("passes through expires_in when Meta sends one", async () => {
		const s = stub({ access_token: "t", expires_in: 5184000 });
		const res = await createGraphClient({ fetch: s.fetch }).exchangeCode({
			clientId: "a",
			clientSecret: "b",
			code: "c",
		});
		expect(res.expiresIn).toBe(5184000);
	});

	it("debug_token: expires_at 0 means the token never expires", async () => {
		const s = stub({
			data: { is_valid: true, expires_at: 0, scopes: ["instagram_basic"] },
		});
		const res = await createGraphClient({ fetch: s.fetch }).debugToken({
			appId: "app",
			appSecret: "sec",
			inputToken: "SUAT",
		});
		expect(res).toEqual({
			isValid: true,
			expiresAt: null,
			scopes: ["instagram_basic"],
		});
		const u = s.calls[0]?.url;
		expect(u?.pathname).toBe(`/${V}/debug_token`);
		expect(u?.searchParams.get("input_token")).toBe("SUAT");
		expect(u?.searchParams.get("access_token")).toBe("app|sec");
	});

	it("debug_token: a unix expires_at becomes a Date; invalid is reported", async () => {
		const s = stub([
			{ data: { is_valid: true, expires_at: 1800000000 } },
			{ data: { is_valid: false } },
		]);
		const client = createGraphClient({ fetch: s.fetch });
		const p = { appId: "a", appSecret: "s", inputToken: "t" };
		expect((await client.debugToken(p)).expiresAt).toEqual(
			new Date(1800000000 * 1000),
		);
		expect((await client.debugToken(p)).isValid).toBe(false);
	});

	it("lists assigned Instagram accounts (zero, one, several, paged)", async () => {
		const zero = stub({ data: [] });
		expect(
			await createGraphClient({ fetch: zero.fetch }).assignedInstagramAccounts(
				"tok",
			),
		).toEqual([]);

		const one = stub({ data: [{ id: "1784", username: "memes" }] });
		const res = await createGraphClient({
			fetch: one.fetch,
		}).assignedInstagramAccounts("tok");
		expect(res).toEqual([{ id: "1784", username: "memes" }]);
		const u = one.calls[0]?.url;
		expect(u?.origin).toBe("https://graph.facebook.com");
		expect(u?.pathname).toBe(`/${V}/me/assigned_instagram_accounts`);
		expect(u?.searchParams.get("fields")).toBe("id,username");
		expect(u?.searchParams.get("access_token")).toBe("tok");

		const many = stub([
			{
				data: [{ id: "1", username: "a" }],
				paging: { cursors: { after: "CUR" }, next: "https://x" },
			},
			{ data: [{ id: "2", username: "b" }], paging: { cursors: {} } },
		]);
		const all = await createGraphClient({
			fetch: many.fetch,
		}).assignedInstagramAccounts("tok");
		expect(all.map((a) => a.id)).toEqual(["1", "2"]);
		expect(many.calls[1]?.url.searchParams.get("after")).toBe("CUR");
	});

	it("creates image containers with alt text, only documented params", async () => {
		const s = stub({ id: "c1" });
		const client = createGraphClient({
			fetch: s.fetch,
			defaultToken: "tok",
			defaultIgUserId: "ig1",
		});
		await client.createImageContainer({
			imageUrl: "https://img/1.jpg",
			caption: "hi",
			altText: "a cat",
			isCarouselItem: true,
		});
		const c = s.calls[0];
		expect(c?.url.toString()).toBe(`https://graph.facebook.com/${V}/ig1/media`);
		expect(c?.init.method).toBe("POST");
		expect(Object.fromEntries(c?.body ?? [])).toEqual({
			image_url: "https://img/1.jpg",
			caption: "hi",
			alt_text: "a cat",
			is_carousel_item: "true",
			access_token: "tok",
		});
		expect(c?.init.headers).not.toHaveProperty("Authorization");
	});

	it("creates carousel containers, checks status and publishes", async () => {
		const s = stub([
			{ id: "car" },
			{ id: "car", status_code: "FINISHED" },
			{ id: "media9" },
		]);
		const client = createGraphClient({ fetch: s.fetch });
		await client.createCarouselContainer({
			igUserId: "ig1",
			token: "tok",
			children: ["a", "b"],
			caption: "cap",
		});
		expect(Object.fromEntries(s.calls[0]?.body ?? [])).toEqual({
			media_type: "CAROUSEL",
			children: "a,b",
			caption: "cap",
			access_token: "tok",
		});
		expect(await client.containerStatus("car", "tok")).toEqual({
			id: "car",
			status_code: "FINISHED",
		});
		expect(s.calls[1]?.url.pathname).toBe(`/${V}/car`);
		expect(s.calls[1]?.url.searchParams.get("fields")).toBe("status_code");
		expect(
			await client.publish({
				igUserId: "ig1",
				token: "tok",
				creationId: "car",
			}),
		).toEqual({ id: "media9" });
		expect(s.calls[2]?.url.toString()).toBe(
			`https://graph.facebook.com/${V}/ig1/media_publish`,
		);
		expect(Object.fromEntries(s.calls[2]?.body ?? [])).toEqual({
			creation_id: "car",
			access_token: "tok",
		});
	});

	it("reads media, recent media and the publishing limit", async () => {
		const s = stub([
			{ id: "m1", permalink: "https://instagram.com/p/x" },
			{ data: [{ id: "m1", timestamp: "t" }] },
			{ data: [{ quota_usage: 7, config: { quota_total: 100 } }] },
		]);
		const client = createGraphClient({ fetch: s.fetch });
		await client.media("m1", ["id", "permalink"], "tok");
		expect(s.calls[0]?.url.pathname).toBe(`/${V}/m1`);
		expect(s.calls[0]?.url.searchParams.get("fields")).toBe("id,permalink");
		expect((await client.recentMedia("ig1", 5, "tok")).data).toHaveLength(1);
		expect(s.calls[1]?.url.pathname).toBe(`/${V}/ig1/media`);
		expect(s.calls[1]?.url.searchParams.get("limit")).toBe("5");
		expect(await client.publishingLimit("ig1", "tok")).toEqual({
			used: 7,
			total: 100,
		});
		expect(s.calls[2]?.url.pathname).toBe(`/${V}/ig1/content_publishing_limit`);
		for (const c of s.calls) expect(c.url.host).toBe("graph.facebook.com");
	});

	it("flags error 190 as token invalid and 4 as rate limit", async () => {
		const bad = stub(
			{
				error: {
					message: "Session has expired",
					code: 190,
					error_subcode: 463,
				},
			},
			400,
		);
		const err = await createGraphClient({ fetch: bad.fetch })
			.containerStatus("c", "tok")
			.catch((e) => e);
		expect(err).toBeInstanceOf(GraphError);
		expect(err.isTokenExpired).toBe(true);
		expect(err.isRateLimit).toBe(false);

		const limited = stub(
			{ error: { message: "Application request limit reached", code: 4 } },
			400,
		);
		const err2 = await createGraphClient({ fetch: limited.fetch })
			.containerStatus("c", "tok")
			.catch((e) => e);
		expect(err2.isRateLimit).toBe(true);
	});

	it("redacts tokens, secrets and the code from error messages", async () => {
		const s = stub(
			{
				error: {
					message: "bad SUPER_TOKEN and SUPER_SECRET and SUPER_CODE",
					code: 100,
				},
			},
			400,
		);
		const client = createGraphClient({ fetch: s.fetch });
		const e1 = await client.media("m", ["id"], "SUPER_TOKEN").catch((e) => e);
		expect(e1.message).not.toContain("SUPER_TOKEN");
		const e2 = await client
			.exchangeCode({
				clientId: "a",
				clientSecret: "SUPER_SECRET",
				code: "SUPER_CODE",
			})
			.catch((e) => e);
		expect(e2.message).not.toContain("SUPER_SECRET");
		expect(e2.message).not.toContain("SUPER_CODE");
		expect(e2.message).toContain("[REDACTED]");
	});

	it("redacts the token from network errors", async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error("connect failed: https://x/?access_token=TOPSECRET");
		});
		const err = await createGraphClient({
			fetch: fetchFn as unknown as typeof fetch,
		})
			.media("m", ["id"], "TOPSECRET")
			.catch((e) => e);
		expect(err.message).not.toContain("TOPSECRET");
	});

	it("uses INSTAGRAM_GRAPH_VERSION from the environment", async () => {
		vi.stubEnv("INSTAGRAM_GRAPH_VERSION", "v99.0");
		try {
			const s = stub({ id: "m", status_code: "FINISHED" });
			await createGraphClient({ fetch: s.fetch }).containerStatus("m", "tok");
			expect(s.calls[0]?.url.pathname).toBe("/v99.0/m");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
