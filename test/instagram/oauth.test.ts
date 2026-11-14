import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as setDefaultAccountRoute } from "@/app/api/instagram/accounts/[id]/default/route";
import { GET as getLimitRoute } from "@/app/api/instagram/accounts/[id]/limit/route";
import { DELETE as deleteAccountRoute } from "@/app/api/instagram/accounts/[id]/route";
import { GET as getAccounts } from "@/app/api/instagram/accounts/route";
import { GET as oauthCallback } from "@/app/api/instagram/callback/route";
import { GET as oauthConnect } from "@/app/api/instagram/connect/route";
import { resetEnvCache } from "@/lib/env";
import { encrypt } from "@/lib/instagram/crypto";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createInstagramAccount } from "@/test/helpers/factories";
import { apiRequest, json, routeParams, TEST_USER } from "@/test/helpers/http";
import { ADMIN_USER } from "@/test/helpers/users";

describeWithDb("instagram oauth and accounts routes", () => {
	const validKey = crypto.randomBytes(32).toString("base64");
	const originalEnv = { ...process.env };

	beforeEach(async () => {
		await resetDb();
		process.env.INSTAGRAM_APP_ID = "test_app_id";
		process.env.INSTAGRAM_APP_SECRET = "test_app_secret";
		process.env.TOKEN_ENCRYPTION_KEY = validKey;
		process.env.PUBLIC_URL = "http://localhost:3000";
		resetEnvCache();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		resetEnvCache();
		vi.restoreAllMocks();
	});

	describe("GET /api/instagram/connect", () => {
		it("refuses unauthenticated users with 401", async () => {
			const req = apiRequest("/api/instagram/connect", { user: null });
			const res = await oauthConnect(req, {});
			expect(res.status).toBe(401);
		});

		it("refuses non-admin users with 403", async () => {
			const req = apiRequest("/api/instagram/connect", { user: TEST_USER });
			const res = await oauthConnect(req, {});
			expect(res.status).toBe(403);
		});

		it("returns 503 when feature is disabled", async () => {
			delete process.env.INSTAGRAM_APP_ID;
			resetEnvCache();

			const req = apiRequest("/api/instagram/connect", { user: ADMIN_USER });
			const res = await oauthConnect(req, {});
			expect(res.status).toBe(503);
			const body = await json<{ error: string }>(res);
			expect(body.error).toBe("feature_disabled");
		});

		it("sets state cookie and redirects to Instagram authorize URL", async () => {
			const req = apiRequest("/api/instagram/connect", { user: ADMIN_USER });
			const res = await oauthConnect(req, {});

			expect(res.status).toBe(302);
			const location = res.headers.get("Location");
			expect(location).toContain("https://www.instagram.com/oauth/authorize");
			expect(location).toContain("client_id=test_app_id");
			expect(location).toContain("response_type=code");

			const setCookie = res.headers.get("Set-Cookie");
			expect(setCookie).toContain("ig_oauth_state=");
			expect(setCookie).toContain("HttpOnly");
			expect(setCookie).toContain("SameSite=Lax");
		});
	});

	describe("state cookie flags", () => {
		it("marks the state cookie Secure when PUBLIC_URL is https", async () => {
			process.env.PUBLIC_URL = "https://memes.example.com";
			resetEnvCache();
			const res = await oauthConnect(
				apiRequest("/api/instagram/connect", { user: ADMIN_USER }),
				{},
			);
			expect(res.headers.get("Set-Cookie")).toContain("Secure");
			expect(res.headers.get("Location")).toContain(
				encodeURIComponent("https://memes.example.com/api/instagram/callback"),
			);
		});
	});

	describe("GET /api/instagram/callback", () => {
		it("rejects mismatched or missing state cookie with 400", async () => {
			const req = apiRequest(
				"/api/instagram/callback?code=test_code&state=state_123",
				{
					user: ADMIN_USER,
					headers: { Cookie: "ig_oauth_state=different_state" },
				},
			);
			const res = await oauthCallback(req, {});
			expect(res.status).toBe(400);
		});

		it("is admin-only: a regular user cannot complete the flow", async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal("fetch", fetchSpy);
			const res = await oauthCallback(
				apiRequest("/api/instagram/callback?code=c&state=s", {
					user: TEST_USER,
					headers: { Cookie: "ig_oauth_state=s" },
				}),
				{},
			);
			expect(res.status).toBe(403);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it("redirects to /settings when the user denies access", async () => {
			const res = await oauthCallback(
				apiRequest(
					"/api/instagram/callback?error=access_denied&error_description=nope",
					{ user: ADMIN_USER },
				),
				{},
			);
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=denied",
			);
			expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
		});

		it("rejects a callback with neither code nor error with 400", async () => {
			const res = await oauthCallback(
				apiRequest("/api/instagram/callback", { user: ADMIN_USER }),
				{},
			);
			expect(res.status).toBe(400);
		});

		it("exchanges code, upserts account, audits and redirects to /settings", async () => {
			const state = "valid_state_456";
			const mockFetch = vi.fn(async (url: string | URL | Request) => {
				const urlStr = String(url);
				if (urlStr.includes("api.instagram.com/oauth/access_token")) {
					return Response.json({
						access_token: "short_lived_1",
						user_id: 1784149999,
					});
				}
				if (urlStr.includes("graph.instagram.com/access_token")) {
					return Response.json({
						access_token: "long_lived_secret_token",
						token_type: "bearer",
						expires_in: 5184000,
					});
				}
				if (urlStr.includes("/me?fields=user_id,username")) {
					return Response.json({
						id: "1784149999",
						user_id: "1784149999",
						username: "great_memes",
					});
				}
				return new Response(null, { status: 404 });
			});

			vi.stubGlobal("fetch", mockFetch);

			const req = apiRequest(
				`/api/instagram/callback?code=auth_code_xyz&state=${state}`,
				{
					user: ADMIN_USER,
					headers: { Cookie: `ig_oauth_state=${state}` },
				},
			);

			const res = await oauthCallback(req, {});
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=connected",
			);
			expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

			// Check database account
			const accountsRes = await getAccounts(
				apiRequest("/api/instagram/accounts", { user: ADMIN_USER }),
				{},
			);
			const accounts =
				await json<Array<{ username: string; isDefault: boolean }>>(
					accountsRes,
				);
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.username).toBe("great_memes");
			expect(accounts[0]?.isDefault).toBe(true);
		});
	});

	describe("GET /api/instagram/accounts and DELETE", () => {
		it("lists accounts and deletes account with admin check", async () => {
			const acc1 = await createInstagramAccount({
				username: "acc1",
				isDefault: true,
				accessTokenEnc: encrypt("tok1", validKey),
			});
			const acc2 = await createInstagramAccount({
				username: "acc2",
				isDefault: false,
				accessTokenEnc: encrypt("tok2", validKey),
			});

			const listRes = await getAccounts(
				apiRequest("/api/instagram/accounts", { user: TEST_USER }),
				{},
			);
			expect(listRes.status).toBe(200);
			const list = await json<Array<{ id: string; username: string }>>(listRes);
			expect(list).toHaveLength(2);
			// Does not expose access tokens
			expect(
				(list[0] as unknown as Record<string, unknown>).accessTokenEnc,
			).toBeUndefined();

			// Non-admin DELETE fails with 403
			const forbiddenDelete = await deleteAccountRoute(
				apiRequest(`/api/instagram/accounts/${acc1.id}`, {
					method: "DELETE",
					user: TEST_USER,
				}),
				routeParams({ id: acc1.id }),
			);
			expect(forbiddenDelete.status).toBe(403);

			// Admin DELETE succeeds with 204
			const deleteRes = await deleteAccountRoute(
				apiRequest(`/api/instagram/accounts/${acc1.id}`, {
					method: "DELETE",
					user: ADMIN_USER,
				}),
				routeParams({ id: acc1.id }),
			);
			expect(deleteRes.status).toBe(204);

			// acc2 should now be promoted to default
			const remainingRes = await getAccounts(
				apiRequest("/api/instagram/accounts", { user: ADMIN_USER }),
				{},
			);
			const remaining =
				await json<Array<{ id: string; isDefault: boolean }>>(remainingRes);
			expect(remaining).toHaveLength(1);
			expect(remaining[0]?.id).toBe(acc2.id);
			expect(remaining[0]?.isDefault).toBe(true);
		});
	});

	describe("POST /api/instagram/accounts/:id/default", () => {
		it("switches default account", async () => {
			const _acc1 = await createInstagramAccount({
				username: "acc1",
				isDefault: true,
				accessTokenEnc: encrypt("tok1", validKey),
			});
			const acc2 = await createInstagramAccount({
				username: "acc2",
				isDefault: false,
				accessTokenEnc: encrypt("tok2", validKey),
			});

			const nonAdmin = await setDefaultAccountRoute(
				apiRequest(`/api/instagram/accounts/${acc2.id}/default`, {
					method: "POST",
					user: TEST_USER,
				}),
				routeParams({ id: acc2.id }),
			);
			expect(nonAdmin.status).toBe(403);

			const adminSwitch = await setDefaultAccountRoute(
				apiRequest(`/api/instagram/accounts/${acc2.id}/default`, {
					method: "POST",
					user: ADMIN_USER,
				}),
				routeParams({ id: acc2.id }),
			);
			expect(adminSwitch.status).toBe(200);
			const updated = await json<{ id: string; isDefault: boolean }>(
				adminSwitch,
			);
			expect(updated.id).toBe(acc2.id);
			expect(updated.isDefault).toBe(true);
		});
	});

	describe("GET /api/instagram/accounts/:id/limit", () => {
		it("returns publishing limit for account", async () => {
			const acc = await createInstagramAccount({
				igUserId: "ig_limit_user",
				accessTokenEnc: encrypt("tok", validKey),
			});

			vi.stubGlobal(
				"fetch",
				vi.fn(async () =>
					Response.json({
						data: [
							{
								quota_usage: 18,
								config: { quota_total: 100, quota_duration: 86400 },
							},
						],
					}),
				),
			);

			const res = await getLimitRoute(
				apiRequest(`/api/instagram/accounts/${acc.id}/limit`, {
					user: TEST_USER,
				}),
				routeParams({ id: acc.id }),
			);

			expect(res.status).toBe(200);
			const limit = await json<{ used: number; total: number }>(res);
			expect(limit).toEqual({ used: 18, total: 100 });
		});
	});
});
