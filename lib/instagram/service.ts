import type { InstagramAccountDto, PublishingLimitDto } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { badRequest, featureDisabled, notFound } from "@/lib/http/errors";
import { decrypt, encrypt } from "@/lib/instagram/crypto";
import { createGraphClient } from "@/lib/instagram/graph";

export function checkInstagramFeature(): void {
	if (!features().instagram) {
		throw featureDisabled("Instagram");
	}
}

export function toAccountDto(row: {
	id: string;
	igUserId: string;
	username: string;
	tokenExpiresAt: Date;
	isDefault: boolean;
	createdAt: Date;
}): InstagramAccountDto {
	return {
		id: row.id,
		igUserId: row.igUserId,
		username: row.username,
		tokenExpiresAt: row.tokenExpiresAt.toISOString(),
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

	return client.publishingLimit(account.igUserId, token);
}

export type OAuthCallbackInput = {
	code: string;
	state: string;
	cookieState: string | undefined;
	actorId: string | null;
	customFetch?: typeof fetch;
};

export async function handleOAuthCallback(
	input: OAuthCallbackInput,
): Promise<InstagramAccountDto> {
	checkInstagramFeature();

	if (!input.cookieState || input.state !== input.cookieState) {
		throw badRequest("Invalid OAuth state parameter");
	}

	const e = env();
	const client = createGraphClient({ fetch: input.customFetch });
	const redirectUri = `${e.PUBLIC_URL}/api/instagram/callback`;

	// Exchange code for short-lived token
	const shortTokenRes = await client.exchangeCode({
		clientId: e.INSTAGRAM_APP_ID as string,
		clientSecret: e.INSTAGRAM_APP_SECRET as string,
		redirectUri,
		code: input.code,
	});

	// Exchange short-lived token for long-lived token (60 days)
	const longTokenRes = await client.exchangeLongLived({
		clientSecret: e.INSTAGRAM_APP_SECRET as string,
		accessToken: shortTokenRes.accessToken,
	});

	// Retrieve user profile (user_id, username)
	const profile = await client.me(longTokenRes.accessToken);

	const tokenExpiresAt = new Date(Date.now() + longTokenRes.expiresIn * 1000);
	const accessTokenEnc = encrypt(longTokenRes.accessToken);

	// The first account becomes default
	const existingCount = await db().instagramAccount.count();
	const existingDefault = await db().instagramAccount.findFirst({
		where: { isDefault: true },
	});
	const isDefault = existingCount === 0 || !existingDefault;

	const account = await db().instagramAccount.upsert({
		where: { igUserId: profile.userId },
		create: {
			igUserId: profile.userId,
			username: profile.username,
			accessTokenEnc,
			tokenExpiresAt,
			connectedById: input.actorId,
			isDefault,
		},
		update: {
			username: profile.username,
			accessTokenEnc,
			tokenExpiresAt,
			connectedById: input.actorId,
		},
	});

	await audit({
		actorId: input.actorId,
		action: "instagram.connect",
		subjectType: "instagram_account",
		subjectId: account.id,
		data: { username: account.username, igUserId: account.igUserId },
	});

	return toAccountDto(account);
}
