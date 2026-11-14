import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Database factories for integration tests. Every slice uses these instead of
 * writing its own, so rows always satisfy the schema's constraints. Pass
 * overrides for whatever the test cares about.
 */

let counter = 0;
const next = () => ++counter;

export async function createImmichAsset(
	overrides: Partial<Prisma.ImmichAssetUncheckedCreateInput> = {},
) {
	const n = next();
	return db().immichAsset.create({
		data: {
			immichId: randomUUID(),
			checksum: createHash("sha1").update(`asset-${n}`).digest("base64"),
			originalFileName: `Screenshot_${n}.png`,
			mimeType: "image/png",
			width: 1170,
			height: 2532,
			fileCreatedAt: new Date("2019-05-01T12:00:00Z"),
			prefilterScore: 0.6,
			triageStatus: "scored",
			memeProbability: 0.9,
			...overrides,
		},
	});
}

export async function createMeme(
	overrides: Partial<Prisma.MemeUncheckedCreateInput> = {},
) {
	const n = next();
	return db().meme.create({
		data: {
			source: "immich",
			status: "inbox",
			contentType: "image/png",
			size: 1000 + n,
			width: 1080,
			height: 1080,
			sha256: createHash("sha256")
				.update(`meme-${n}-${randomUUID()}`)
				.digest("hex"),
			renditionsReady: true,
			description: `Meme ${n}`,
			...overrides,
		},
	});
}

export async function createInstagramAccount(
	overrides: Partial<Prisma.InstagramAccountUncheckedCreateInput> = {},
) {
	const n = next();
	return db().instagramAccount.create({
		data: {
			igUserId: `1784${n}`,
			username: `memes_${n}`,
			accessTokenEnc: "not-a-real-token",
			tokenExpiresAt: new Date(Date.now() + 50 * 24 * 3600 * 1000),
			isDefault: n === 1,
			...overrides,
		},
	});
}

export async function createPost(
	memeIds: string[],
	overrides: Partial<Prisma.PostUncheckedCreateInput> = {},
) {
	return db().post.create({
		data: {
			kind: memeIds.length > 1 ? "carousel" : "image",
			status: "draft",
			caption: "test caption",
			...overrides,
			items: {
				create: memeIds.map((memeId, position) => ({ memeId, position })),
			},
		},
		include: { items: true },
	});
}
