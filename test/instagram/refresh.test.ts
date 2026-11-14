import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/instagram/crypto";
import { refreshExpiringTokens } from "@/lib/instagram/refresh";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createInstagramAccount } from "@/test/helpers/factories";

describeWithDb("instagram refresh tokens job", () => {
	const validKey = crypto.randomBytes(32).toString("base64");
	const originalEnv = { ...process.env };

	beforeEach(async () => {
		await resetDb();
		process.env.INSTAGRAM_APP_ID = "test_app_id";
		process.env.INSTAGRAM_APP_SECRET = "test_app_secret";
		process.env.TOKEN_ENCRYPTION_KEY = validKey;
		resetEnvCache();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		resetEnvCache();
		vi.restoreAllMocks();
	});

	it("refreshes accounts expiring within 10 days and updates database", async () => {
		const now = new Date("2026-11-14T12:00:00Z");

		// Account expiring in 5 days (needs refresh)
		const expiringSoon = await createInstagramAccount({
			username: "expiring_soon",
			accessTokenEnc: encrypt("old_token_1", validKey),
			tokenExpiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
		});

		// Account expiring in 40 days (should be skipped)
		const healthyAccount = await createInstagramAccount({
			username: "healthy_account",
			accessTokenEnc: encrypt("healthy_token", validKey),
			tokenExpiresAt: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
		});

		const mockFetch = vi.fn(async (url: string | URL | Request) => {
			const urlStr = String(url);
			if (urlStr.includes("refresh_access_token")) {
				return Response.json({
					access_token: "brand_new_refreshed_token",
					token_type: "bearer",
					expires_in: 5184000, // 60 days
				});
			}
			return new Response(null, { status: 404 });
		});

		const count = await refreshExpiringTokens({
			now: () => now,
			fetch: mockFetch as unknown as typeof fetch,
		});

		expect(count).toBe(1);

		// Check updated account in DB
		const updated = await db().instagramAccount.findUniqueOrThrow({
			where: { id: expiringSoon.id },
		});
		expect(decrypt(updated.accessTokenEnc, validKey)).toBe(
			"brand_new_refreshed_token",
		);
		expect(updated.tokenExpiresAt.getTime()).toBe(
			now.getTime() + 5184000 * 1000,
		);

		// Check audit event
		const auditEvent = await db().auditEvent.findFirst({
			where: {
				action: "instagram.token_refresh",
				subjectId: expiringSoon.id,
			},
		});
		expect(auditEvent).not.toBeNull();

		// Healthy account remained untouched
		const untouched = await db().instagramAccount.findUniqueOrThrow({
			where: { id: healthyAccount.id },
		});
		expect(untouched.tokenExpiresAt.toISOString()).toBe(
			healthyAccount.tokenExpiresAt.toISOString(),
		);
	});
});
