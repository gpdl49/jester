import { describe, expect, it, vi } from "vitest";
import { createGraphClient, GraphError } from "./graph";

describe("instagram graph client", () => {
	it("exchanges authorization code for short-lived token", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "short_token_123",
				user_id: 1784140001,
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.exchangeCode({
			clientId: "my_app_id",
			clientSecret: "my_secret",
			redirectUri: "https://example.com/callback",
			code: "auth_code_xyz",
		});

		expect(res).toEqual({
			accessToken: "short_token_123",
			userId: "1784140001",
		});
		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.instagram.com/oauth/access_token",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			}),
		);
	});

	it("exchanges short-lived token for long-lived token", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "long_token_abc",
				token_type: "bearer",
				expires_in: 5184000,
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.exchangeLongLived({
			clientSecret: "my_secret",
			accessToken: "short_token_123",
		});

		expect(res).toEqual({
			accessToken: "long_token_abc",
			tokenType: "bearer",
			expiresIn: 5184000,
		});
		const calledUrl = (mockFetch.mock.calls[0]?.[0] as string) ?? "";
		expect(calledUrl).toContain("https://graph.instagram.com/access_token");
		expect(calledUrl).toContain("grant_type=ig_exchange_token");
	});

	it("refreshes long-lived token", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "refreshed_token_xyz",
				token_type: "bearer",
				expires_in: 5184000,
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.refreshToken({
			accessToken: "old_token",
		});

		expect(res).toEqual({
			accessToken: "refreshed_token_xyz",
			tokenType: "bearer",
			expiresIn: 5184000,
		});
		const calledUrl = (mockFetch.mock.calls[0]?.[0] as string) ?? "";
		expect(calledUrl).toContain("grant_type=ig_refresh_token");
	});

	it("fetches me profile info", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				id: "1784140001",
				user_id: "1784140001",
				username: "memes_account",
			}),
		});

		const client = createGraphClient({
			version: "v25.0",
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.me("token_123");

		expect(res).toEqual({
			id: "1784140001",
			userId: "1784140001",
			username: "memes_account",
		});
		expect(mockFetch).toHaveBeenCalledWith(
			"https://graph.instagram.com/v25.0/me?fields=user_id,username",
			expect.objectContaining({
				headers: { Authorization: "Bearer token_123" },
			}),
		);
	});

	it("creates image container with caption and alt text", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "container_img_1" }),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.createImageContainer({
			igUserId: "ig_user_1",
			token: "tok",
			imageUrl: "https://example.com/img.jpg",
			caption: "Funny meme",
			altText: "A funny cat",
			isCarouselItem: false,
		});

		expect(res).toEqual({ id: "container_img_1" });
		expect(mockFetch).toHaveBeenCalledWith(
			"https://graph.instagram.com/v25.0/ig_user_1/media",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer tok",
				}),
				body: expect.stringContaining(
					"image_url=https%3A%2F%2Fexample.com%2Fimg.jpg",
				),
			}),
		);
	});

	it("creates carousel container", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "carousel_parent_1" }),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.createCarouselContainer({
			igUserId: "ig_user_1",
			token: "tok",
			children: ["child1", "child2"],
			caption: "Carousel caption",
		});

		expect(res).toEqual({ id: "carousel_parent_1" });
		expect(mockFetch).toHaveBeenCalledWith(
			"https://graph.instagram.com/v25.0/ig_user_1/media",
			expect.objectContaining({
				body: expect.stringContaining("children=child1%2Cchild2"),
			}),
		);
	});

	it("checks container status", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "c1", status_code: "FINISHED" }),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.containerStatus("c1", "tok");

		expect(res).toEqual({ id: "c1", status_code: "FINISHED" });
		expect(mockFetch).toHaveBeenCalledWith(
			"https://graph.instagram.com/v25.0/c1?fields=status_code",
			expect.anything(),
		);
	});

	it("publishes a container", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "published_media_1" }),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const res = await client.publish("c1", {
			igUserId: "ig_user_1",
			token: "tok",
		});

		expect(res).toEqual({ id: "published_media_1" });
		expect(mockFetch).toHaveBeenCalledWith(
			"https://graph.instagram.com/v25.0/ig_user_1/media_publish",
			expect.objectContaining({
				body: "creation_id=c1",
			}),
		);
	});

	it("fetches media details and recentMedia", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						id: "m1",
						caption: "Cap 1",
						timestamp: "2026-11-14T12:00:00Z",
						permalink: "https://instagr.am/p/123",
					},
				],
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const recent = await client.recentMedia("ig_user_1", 10, "tok");

		expect(recent.data).toHaveLength(1);
		expect(recent.data[0]?.id).toBe("m1");
	});

	it("fetches publishing limit", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						quota_usage: 14,
						config: { quota_total: 100, quota_duration: 86400 },
					},
				],
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		const limit = await client.publishingLimit("ig_user_1", "tok");

		expect(limit).toEqual({ used: 14, total: 100 });
	});

	it("identifies token expiry error (code 190)", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: async () => ({
				error: {
					message: "Error validating access token: Session has expired on...",
					type: "OAuthException",
					code: 190,
					error_subcode: 463,
				},
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		await expect(client.me("expired_tok")).rejects.toThrow(GraphError);

		try {
			await client.me("expired_tok");
		} catch (e) {
			const err = e as GraphError;
			expect(err.code).toBe(190);
			expect(err.isTokenExpired).toBe(true);
			expect(err.isRateLimit).toBe(false);
		}
	});

	it("identifies rate limit errors", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: async () => ({
				error: {
					message: "Application request limit reached",
					code: 4,
				},
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		try {
			await client.containerStatus("c1", "tok");
		} catch (e) {
			const err = e as GraphError;
			expect(err.code).toBe(4);
			expect(err.isRateLimit).toBe(true);
		}
	});

	it("redacts access token from error messages", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: async () => ({
				error: {
					message: "Invalid token super_secret_access_token_xyz provided",
					code: 100,
				},
			}),
		});

		const client = createGraphClient({
			fetch: mockFetch as unknown as typeof fetch,
		});
		try {
			await client.me("super_secret_access_token_xyz");
		} catch (e) {
			const err = e as GraphError;
			expect(err.message).not.toContain("super_secret_access_token_xyz");
			expect(err.message).toContain("[REDACTED]");
		}
	});

	it("uses INSTAGRAM_GRAPH_VERSION from the environment", async () => {
		vi.stubEnv("INSTAGRAM_GRAPH_VERSION", "v99.0");
		try {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(Response.json({ id: "1", username: "u" }));
			const client = createGraphClient({
				fetch: mockFetch as unknown as typeof fetch,
			});
			await client.me("tok");
			expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
				"graph.instagram.com/v99.0/me",
			);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
