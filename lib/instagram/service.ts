import { timingSafeEqual } from "node:crypto";
import type { InstagramAccountDto, PublishingLimitDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { badRequest, featureDisabled, notFound } from "@/lib/http/errors";
import { decrypt, encrypt } from "@/lib/instagram/crypto";
import { createGraphClient, GraphError } from "@/lib/instagram/graph";

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkInstagramFeature(): void {
	if (!features().instagram) {
		throw featureDisabled("Instagram");
	}
}

export function toAccountDto(row: {
	id: string;
	igUserId: string;
	username: string;
	tokenExpiresAt: Date | null;
	needsReconnect: boolean;
	isDefault: boolean;
	createdAt: Date;
}): InstagramAccountDto {
	return {
		id: row.id,
		igUserId: row.igUserId,
		username: row.username,
		tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
		needsReconnect: row.needsReconnect,
		isDefault: row.isDefault,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function listAccounts(): Promise<InstagramAccountDto[]> {
	checkInstagramFeature();
	const rows = await db().instagramAccount.findMany({
		orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
	});
	return rows.map(toAccountDto);
}

export async function deleteAccount(
	id: string,
	actorId: string | null,
): Promise<void> {
	checkInstagramFeature();
	const existing = await db().instagramAccount.findUnique({
		where: { id },
	});
	if (!existing) {
		throw notFound("Instagram account not found");
	}

	await db().instagramAccount.delete({
		where: { id },
	});

	// If the deleted account was the default, make another account default if available
	if (existing.isDefault) {
		const nextAccount = await db().instagramAccount.findFirst({
			orderBy: { createdAt: "asc" },
		});
		if (nextAccount) {
			await db().instagramAccount.update({
				where: { id: nextAccount.id },
				data: { isDefault: true },
			});
		}
	}

	await audit({
		actorId,
		action: "instagram.disconnect",
		subjectType: "instagram_account",
		subjectId: id,
		data: { username: existing.username, igUserId: existing.igUserId },
	});
}

export async function setDefaultAccount(
	id: string,
	actorId: string | null,
): Promise<InstagramAccountDto> {
	checkInstagramFeature();
	const existing = await db().instagramAccount.findUnique({
		where: { id },
	});
	if (!existing) {
		throw notFound("Instagram account not found");
	}

	const updated = await db().$transaction(async (tx) => {
		await tx.instagramAccount.updateMany({
			data: { isDefault: false },
		});
		return tx.instagramAccount.update({
			where: { id },
			data: { isDefault: true },
		});
	});

	await audit({
		actorId,
		action: "instagram.set_default",
		subjectType: "instagram_account",
		subjectId: id,
		data: { username: updated.username },
	});

	return toAccountDto(updated);
}

export async function getAccountLimit(
	id: string,
	customFetch?: typeof fetch,
): Promise<PublishingLimitDto> {
	checkInstagramFeature();
	const account = await db().instagramAccount.findUnique({
		where: { id },
	});
	if (!account) {
		throw notFound("Instagram account not found");
	}

	const token = decrypt(account.accessTokenEnc);
	const client = createGraphClient({
		fetch: customFetch,
		defaultToken: token,
		defaultIgUserId: account.igUserId,
	});

	try {
		return await client.publishingLimit(account.igUserId, token);
	} catch (err) {
		if (err instanceof GraphError && err.isTokenExpired) {
			await markNeedsReconnect(account.id, account.username);
		}
		throw err;
	}
}

/** Meta rejected the token (error 190): flag the account for reconnection. */
export async function markNeedsReconnect(
	id: string,
	username: string,
): Promise<void> {
	const res = await db().instagramAccount.updateMany({
		where: { id, needsReconnect: false },
		data: { needsReconnect: true },
	});
	if (res.count > 0) {
		await audit({
			actorId: null,
			action: "instagram.token_invalid",
			subjectType: "instagram_account",
			subjectId: id,
			data: { username },
		});
	}
}

export type OAuthCallbackInput = {
	code: string;
	state: string;
	cookieState: string | undefined;
	actorId: string | null;
	customFetch?: typeof fetch;
};

export type OAuthCallbackResult = {
	accounts: InstagramAccountDto[];
	/** More than one account is connected and none is the default yet. */
	needsChoice: boolean;
};

export async function handleOAuthCallback(
	input: OAuthCallbackInput,
): Promise<OAuthCallbackResult> {
	checkInstagramFeature();

	if (!input.cookieState || !safeEqual(input.state, input.cookieState)) {
		throw badRequest("Invalid OAuth state parameter");
	}

	const e = env();
	const appId = e.INSTAGRAM_APP_ID as string;
	const appSecret = e.INSTAGRAM_APP_SECRET as string;
	const client = createGraphClient({ fetch: input.customFetch });

	// Code -> Business Integration System User access token.
	const exchanged = await client.exchangeCode({
		clientId: appId,
		clientSecret: appSecret,
		code: input.code,
	});
	const token = exchanged.accessToken;

	// Reachable Instagram professional accounts (the client chose them in the
	// login dialog).
	const reachable = await client.assignedInstagramAccounts(token);
	if (reachable.length === 0) return { accounts: [], needsChoice: false };

	// `expires_at` 0 means the token never expires; fall back to `expires_in`.
	let tokenExpiresAt: Date | null =
		exchanged.expiresIn && exchanged.expiresIn > 0
			? new Date(Date.now() + exchanged.expiresIn * 1000)
			: null;
	try {
		const info = await client.debugToken({
			appId,
			appSecret,
			inputToken: token,
		});
		tokenExpiresAt = info.expiresAt;
	} catch {
		// keep the fallback; the daily check will fill it in
	}

	const accessTokenEnc = encrypt(token);
	const stored = await db().$transaction(async (tx) => {
		const rows = [];
		for (const a of reachable) {
			rows.push(
				await tx.instagramAccount.upsert({
					where: { igUserId: a.id },
					create: {
						igUserId: a.id,
						username: a.username,
						accessTokenEnc,
						tokenExpiresAt,
						connectedById: input.actorId,
					},
					update: {
						username: a.username,
						accessTokenEnc,
						tokenExpiresAt,
						needsReconnect: false,
						connectedById: input.actorId,
					},
				}),
			);
		}
		// Never pick between several accounts silently: the admin chooses.
		const hasDefault = await tx.instagramAccount.count({
			where: { isDefault: true },
		});
		const total = await tx.instagramAccount.count();
		if (hasDefault === 0 && total === 1 && rows[0]) {
			rows[0] = await tx.instagramAccount.update({
				where: { id: rows[0].id },
				data: { isDefault: true },
			});
		}
		return { rows, needsChoice: hasDefault === 0 && total > 1 };
	});

	for (const account of stored.rows) {
		await audit({
			actorId: input.actorId,
			action: "instagram.connect",
			subjectType: "instagram_account",
			subjectId: account.id,
			data: { username: account.username, igUserId: account.igUserId },
		});
	}

	return {
		accounts: stored.rows.map(toAccountDto),
		needsChoice: stored.needsChoice,
	};
}
