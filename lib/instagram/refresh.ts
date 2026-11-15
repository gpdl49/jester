import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/instagram/crypto";
import {
	createGraphClient,
	type GraphClient,
	GraphError,
} from "@/lib/instagram/graph";
import { markNeedsReconnect } from "@/lib/instagram/service";

export type TokenCheckOptions = {
	graphClient?: GraphClient;
	fetch?: typeof fetch;
};

/**
 * Unified Login tokens are Business Integration System User tokens: they are
 * never refreshed here. Instead each account's token is inspected with
 * `debug_token`: an invalid or revoked token flags the account for
 * reconnection, and the stored expiry (null = never expires) is kept in sync.
 * Returns the number of accounts newly flagged.
 */
export async function checkAccountTokens(
	options: TokenCheckOptions = {},
): Promise<number> {
	const e = env();
	const appId = e.INSTAGRAM_APP_ID;
	const appSecret = e.INSTAGRAM_APP_SECRET;
	if (!appId || !appSecret) return 0;

	const accounts = await db().instagramAccount.findMany({
		where: { needsReconnect: false },
	});
	const client =
		options.graphClient ?? createGraphClient({ fetch: options.fetch });

	let flagged = 0;
	for (const account of accounts) {
		try {
			const info = await client.debugToken({
				appId,
				appSecret,
				inputToken: decrypt(account.accessTokenEnc),
			});
			if (!info.isValid) {
				await markNeedsReconnect(account.id, account.username);
				flagged++;
				continue;
			}
			if (info.expiresAt?.getTime() !== account.tokenExpiresAt?.getTime()) {
				await db().instagramAccount.update({
					where: { id: account.id },
					data: { tokenExpiresAt: info.expiresAt },
				});
			}
		} catch (err) {
			if (err instanceof GraphError && err.isTokenExpired) {
				await markNeedsReconnect(account.id, account.username);
				flagged++;
				continue;
			}
			console.error(
				`Failed to check token for Instagram account ${account.username} (${account.id}):`,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
	// A token past its known expiry also needs reconnecting.
	const lapsed = await db().instagramAccount.findMany({
		where: { needsReconnect: false, tokenExpiresAt: { lte: new Date() } },
	});
	for (const account of lapsed) {
		await markNeedsReconnect(account.id, account.username);
		flagged++;
	}
	await audit({
		actorId: null,
		action: "instagram.token_check",
		subjectType: "instagram_account",
		subjectId: null,
		data: { checked: accounts.length, flagged },
	});
	return flagged;
}
