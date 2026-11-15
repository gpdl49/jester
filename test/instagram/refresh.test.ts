import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { encrypt } from "@/lib/instagram/crypto";
import { checkAccountTokens } from "@/lib/instagram/refresh";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createInstagramAccount } from "@/test/helpers/factories";

describeWithDb("instagram token check job", () => {
	const validKey = crypto.randomBytes(32).toString("base64");
	const originalEnv = { ...process.env };

	beforeEach(async () => {
		await resetDb();
		process.env.INSTAGRAM_APP_ID = "test_app_id";
		process.env.INSTAGRAM_APP_SECRET = "test_app_secret";
		process.env.INSTAGRAM_CONFIG_ID = "cfg";
		process.env.TOKEN_ENCRYPTION_KEY = validKey;
		resetEnvCache();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		resetEnvCache();
		vi.restoreAllMocks();
	});

	function stubDebug(byToken: Record<string, unknown>) {
		const calls: string[] = [];
		const fetchFn = vi.fn(async (url: string | URL | Request) => {
			const u = new URL(String(url));
			calls.push(String(url));
			const input = u.searchParams.get("input_token") ?? "";
			const res = byToken[input];
			if (!res) return new Response(null, { status: 404 });
			return Response.json(res, {
				status: "error" in (res as object) ? 400 : 200,
			});
		});
		return { fetchFn: fetchFn as unknown as typeof fetch, calls };
	}

	it("never refreshes: inspects tokens with debug_token and keeps healthy accounts", async () => {
		const ok = await createInstagramAccount({
			username: "ok",
			accessTokenEnc: encrypt("tok_ok", validKey),
			tokenExpiresAt: null,
		});
		const s = stubDebug({
			tok_ok: { data: { is_valid: true, expires_at: 0 } },
		});
		const flagged = await checkAccountTokens({ fetch: s.fetchFn });
		expect(flagged).toBe(0);
		const row = await db().instagramAccount.findUniqueOrThrow({
			where: { id: ok.id },
		});
		expect(row.needsReconnect).toBe(false);
		expect(row.tokenExpiresAt).toBeNull();
		for (const c of s.calls) {
			expect(c).toContain("https://graph.facebook.com/");
			expect(c).toContain("/debug_token");
			expect(c).not.toContain("refresh_access_token");
		}
	});

	it("updates the stored expiry from debug_token", async () => {
		const acc = await createInstagramAccount({
			accessTokenEnc: encrypt("tok_a", validKey),
			tokenExpiresAt: null,
		});
		const s = stubDebug({
			tok_a: { data: { is_valid: true, expires_at: 1900000000 } },
		});
		await checkAccountTokens({ fetch: s.fetchFn });
		const row = await db().instagramAccount.findUniqueOrThrow({
			where: { id: acc.id },
		});
		expect(row.tokenExpiresAt?.toISOString()).toBe(
			new Date(1900000000 * 1000).toISOString(),
		);
	});

	it("flags accounts whose token is invalid or rejected with 190", async () => {
		const invalid = await createInstagramAccount({
			username: "invalid",
			accessTokenEnc: encrypt("tok_bad", validKey),
		});
		const rejected = await createInstagramAccount({
			username: "rejected",
			accessTokenEnc: encrypt("tok_190", validKey),
		});
		const fine = await createInstagramAccount({
			username: "fine",
			accessTokenEnc: encrypt("tok_fine", validKey),
		});
		const s = stubDebug({
			tok_bad: { data: { is_valid: false } },
			tok_190: { error: { message: "Invalid OAuth access token", code: 190 } },
			tok_fine: { data: { is_valid: true, expires_at: 0 } },
		});
		const flagged = await checkAccountTokens({ fetch: s.fetchFn });
		expect(flagged).toBe(2);
		const rows = await db().instagramAccount.findMany();
		const byId = new Map(rows.map((r) => [r.id, r.needsReconnect]));
		expect(byId.get(invalid.id)).toBe(true);
		expect(byId.get(rejected.id)).toBe(true);
		expect(byId.get(fine.id)).toBe(false);
		expect(
			await db().auditEvent.count({
				where: { action: "instagram.token_invalid" },
			}),
		).toBe(2);
	});

	it("skips accounts already flagged and tolerates transient errors", async () => {
		await createInstagramAccount({
			username: "flagged",
			needsReconnect: true,
			accessTokenEnc: encrypt("tok_f", validKey),
		});
		const flaky = await createInstagramAccount({
			username: "flaky",
			accessTokenEnc: encrypt("tok_flaky", validKey),
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		const s = stubDebug({}); // 404s
		const flagged = await checkAccountTokens({ fetch: s.fetchFn });
		expect(flagged).toBe(0);
		expect(s.calls).toHaveLength(1);
		const row = await db().instagramAccount.findUniqueOrThrow({
			where: { id: flaky.id },
		});
		expect(row.needsReconnect).toBe(false);
	});
});
