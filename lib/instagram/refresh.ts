import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/instagram/crypto";
import { createGraphClient, type GraphClient } from "@/lib/instagram/graph";

export type RefreshOptions = {
	now?: () => Date;
	graphClient?: GraphClient;
	fetch?: typeof fetch;
};

/**
 * Refreshes long-lived access tokens for all Instagram accounts expiring
 * within the next 10 days.
 */
export async function refreshExpiringTokens(
	options: RefreshOptions = {},
): Promise<number> {
	const nowFn = options.now ?? (() => new Date());
	const tenDaysFromNow = new Date(nowFn().getTime() + 10 * 24 * 60 * 60 * 1000);

	const expiringAccounts = await db().instagramAccount.findMany({
		where: {
			tokenExpiresAt: {
				lte: tenDaysFromNow,
			},
		},
	});

	let refreshedCount = 0;

	for (const account of expiringAccounts) {
		try {
			const accessToken = decrypt(account.accessTokenEnc);
			const client =
				options.graphClient ??
				createGraphClient({
					fetch: options.fetch,
					defaultToken: accessToken,
					defaultIgUserId: account.igUserId,
				});

			const res = await client.refreshToken({ accessToken });
			const newAccessTokenEnc = encrypt(res.accessToken);
			const newExpiresAt = new Date(nowFn().getTime() + res.expiresIn * 1000);

			await db().instagramAccount.update({
				where: { id: account.id },
				data: {
					accessTokenEnc: newAccessTokenEnc,
					tokenExpiresAt: newExpiresAt,
				},
			});

			await audit({
				actorId: null,
				action: "instagram.token_refresh",
				subjectType: "instagram_account",
				subjectId: account.id,
				data: {
					username: account.username,
					tokenExpiresAt: newExpiresAt.toISOString(),
				},
			});

			refreshedCount++;
		} catch (err) {
			console.error(
				`Failed to refresh token for Instagram account ${account.username} (${account.id}):`,
				err,
			);
		}
	}

	return refreshedCount;
}
