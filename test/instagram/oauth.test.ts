import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as setDefaultAccountRoute } from "@/app/api/instagram/accounts/[id]/default/route";
import { GET as getLimitRoute } from "@/app/api/instagram/accounts/[id]/limit/route";
import { DELETE as deleteAccountRoute } from "@/app/api/instagram/accounts/[id]/route";
import { GET as getAccounts } from "@/app/api/instagram/accounts/route";
import { GET as oauthCallback } from "@/app/api/instagram/callback/route";
import { GET as oauthConnect } from "@/app/api/instagram/connect/route";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/instagram/crypto";
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
		process.env.INSTAGRAM_CONFIG_ID = "test_config_id";
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

		it("returns 503 without the login configuration id", async () => {
			delete process.env.INSTAGRAM_CONFIG_ID;
			resetEnvCache();
			const res = await oauthConnect(
				apiRequest("/api/instagram/connect", { user: ADMIN_USER }),
				{},
			);
			expect(res.status).toBe(503);
		});

		it("sets state cookie and redirects to the Facebook Login for Business dialog", async () => {
			const req = apiRequest("/api/instagram/connect", { user: ADMIN_USER });
			const res = await oauthConnect(req, {});

			expect(res.status).toBe(302);
			const url = new URL(res.headers.get("Location") as string);
			expect(url.origin + url.pathname).toBe(
				"https://www.facebook.com/v27.0/dialog/oauth",
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				client_id: "test_app_id",
				config_id: "test_config_id",
				redirect_uri: "http://localhost:3000/api/instagram/callback",
				response_type: "code",
				override_default_response_type: "true",
				state: url.searchParams.get("state"),
			});
			// permissions come from the configuration, not a scope parameter
			expect(url.searchParams.has("scope")).toBe(false);

			const setCookie = res.headers.get("Set-Cookie");
			expect(setCookie).toContain("ig_oauth_state=");
			expect(setCookie).toContain(
				`ig_oauth_state=${url.searchParams.get("state")}`,
			);
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

		function graphStub(opts: {
			accounts: Array<{ id: string; username: string }>;
			debug?: unknown;
		}) {
			const urls: string[] = [];
			const fn = vi.fn(async (url: string | URL | Request) => {
				const u = new URL(String(url));
				urls.push(String(url));
				if (u.pathname.endsWith("/oauth/access_token")) {
					return Response.json({ access_token: "suat_secret_token" });
				}
				if (u.pathname.endsWith("/debug_token")) {
					return Response.json(
						opts.debug ?? { data: { is_valid: true, expires_at: 0 } },
					);
				}
				if (u.pathname.endsWith("/me/assigned_instagram_accounts")) {
					return Response.json({ data: opts.accounts });
				}
				return new Response(null, { status: 404 });
			});
			vi.stubGlobal("fetch", fn);
			return { fn, urls };
		}

		async function callback(state = "valid_state_456") {
			return oauthCallback(
				apiRequest(
					`/api/instagram/callback?code=auth_code_xyz&state=${state}`,
					{
						user: ADMIN_USER,
						headers: { Cookie: `ig_oauth_state=${state}` },
					},
				),
				{},
			);
		}

		async function listAccounts() {
			return json<
				Array<{
					id: string;
					username: string;
					isDefault: boolean;
					tokenExpiresAt: string | null;
					needsReconnect: boolean;
				}>
			>(
				await getAccounts(
					apiRequest("/api/instagram/accounts", { user: ADMIN_USER }),
					{},
				),
			);
		}

		it("a Meta error during the code exchange redirects to /settings?instagram=error", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () =>
					Response.json(
						{
							error: {
								message: "Error validating verification code.",
								type: "OAuthException",
								code: 100,
								error_subcode: 36008,
							},
						},
						{ status: 400 },
					),
				),
			);
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const res = await callback();
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=error",
			);
			expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
			expect(errorSpy).toHaveBeenCalled();
			errorSpy.mockRestore();
			expect(await listAccounts()).toHaveLength(0);
		});

		it("one account: exchanges the code, stores it encrypted, makes it default, audits", async () => {
			const g = graphStub({
				accounts: [{ id: "1784149999", username: "great_memes" }],
			});
			const res = await callback();
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=connected",
			);
			expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
			// every call is on graph.facebook.com
			for (const u of g.urls)
				expect(u).toContain("https://graph.facebook.com/v27.0/");
			expect(g.urls[0]).toContain("client_id=test_app_id");
			expect(g.urls[0]).toContain("client_secret=test_app_secret");
			expect(g.urls[0]).toContain("code=auth_code_xyz");
			// identical to the dialog's redirect_uri, or Meta rejects the code
			expect(
				new URL(g.urls[0] as string).searchParams.get("redirect_uri"),
			).toBe("http://localhost:3000/api/instagram/callback");

			const accounts = await listAccounts();
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.username).toBe("great_memes");
			expect(accounts[0]?.isDefault).toBe(true);
			expect(accounts[0]?.tokenExpiresAt).toBeNull();
			expect(accounts[0]?.needsReconnect).toBe(false);
			expect(JSON.stringify(accounts)).not.toContain("suat_secret_token");

			const row = await db().instagramAccount.findFirstOrThrow();
			expect(row.accessTokenEnc).not.toContain("suat_secret_token");
			expect(decrypt(row.accessTokenEnc)).toBe("suat_secret_token");
			expect(row.igUserId).toBe("1784149999");
			expect(
				await db().auditEvent.count({ where: { action: "instagram.connect" } }),
			).toBe(1);
		});

		it("records the token expiry when Meta gives one", async () => {
			graphStub({
				accounts: [{ id: "1", username: "a" }],
				debug: { data: { is_valid: true, expires_at: 1900000000 } },
			});
			await callback();
			expect((await listAccounts())[0]?.tokenExpiresAt).toBe(
				new Date(1900000000 * 1000).toISOString(),
			);
		});

		it("several accounts: stores all, picks none, asks the admin to choose", async () => {
			graphStub({
				accounts: [
					{ id: "1", username: "first" },
					{ id: "2", username: "second" },
				],
			});
			const res = await callback();
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=choose",
			);
			const accounts = await listAccounts();
			expect(accounts.map((a) => a.username).sort()).toEqual([
				"first",
				"second",
			]);
			expect(accounts.some((a) => a.isDefault)).toBe(false);
		});

		it("several accounts with an existing default keeps that default", async () => {
			await createInstagramAccount({
				igUserId: "2",
				username: "second",
				isDefault: true,
			});
			graphStub({
				accounts: [
					{ id: "1", username: "first" },
					{ id: "2", username: "second" },
				],
			});
			const res = await callback();
			expect(res.headers.get("Location")).toContain("instagram=connected");
			const accounts = await listAccounts();
			expect(accounts.find((a) => a.isDefault)?.username).toBe("second");
		});

		it("zero accounts: stores nothing and says so", async () => {
			graphStub({ accounts: [] });
			const res = await callback();
			expect(res.headers.get("Location")).toBe(
				"http://localhost:3000/settings?instagram=no_accounts",
			);
			expect(await listAccounts()).toHaveLength(0);
		});

		it("reconnecting clears the needs-reconnect flag", async () => {
			await createInstagramAccount({
				igUserId: "1",
				username: "a",
				needsReconnect: true,
				isDefault: true,
			});
			graphStub({ accounts: [{ id: "1", username: "a" }] });
			await callback();
			const accounts = await listAccounts();
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.needsReconnect).toBe(false);
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

		it("flags the account for reconnection on error 190", async () => {
			const acc = await createInstagramAccount({
				igUserId: "ig_revoked",
				accessTokenEnc: encrypt("tok", validKey),
			});
			vi.stubGlobal(
				"fetch",
				vi.fn(async () =>
					Response.json(
						{ error: { message: "Session invalid", code: 190 } },
						{ status: 400 },
					),
				),
			);
			await getLimitRoute(
				apiRequest(`/api/instagram/accounts/${acc.id}/limit`, {
					user: TEST_USER,
				}),
				routeParams({ id: acc.id }),
			);
			const row = await db().instagramAccount.findUniqueOrThrow({
				where: { id: acc.id },
			});
			expect(row.needsReconnect).toBe(true);
		});
	});
});
