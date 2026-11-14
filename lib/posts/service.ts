import type {
	MemeSummaryDto,
	PostDetailDto,
	PostItemDto,
	PostSummaryDto,
	Sensitivity,
	UserRefDto,
} from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { instagramPublish } from "@/lib/jobs/definitions/instagram-publish";
import { enqueue } from "@/lib/jobs/queue";
import { renderCaption } from "@/lib/posts/caption";

/**
 * A Postgres serialization failure. With the pg driver adapter Prisma does not
 * report P2034: the error is a DriverAdapterError whose cause (kind
 * TransactionWriteConflict, originalCode 40001) says so.
 */
export function isSerializationFailure(err: unknown): boolean {
	for (
		let e: unknown = err, depth = 0;
		e && typeof e === "object" && depth < 5;
		e = (e as { cause?: unknown }).cause, depth++
	) {
		const { code, originalCode, kind } = e as {
			code?: unknown;
			originalCode?: unknown;
			kind?: unknown;
		};
		if (
			code === "P2034" ||
			originalCode === "40001" ||
			kind === "TransactionWriteConflict"
		) {
			return true;
		}
	}
	return false;
}

async function runSerializable<T>(
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	// Concurrent writers can abort each other (P2034); retry a few times so the
	// loser re-reads and reports a proper 409 instead of a 500.
	for (let attempt = 0; ; attempt++) {
		try {
			return await db().$transaction(fn, {
				isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
			});
		} catch (err) {
			if (isSerializationFailure(err)) {
				if (attempt >= 4) {
					throw conflict("Concurrent update, please retry");
				}
				continue;
			}
			throw err;
		}
	}
}

export type CreatePostInput = {
	memeIds: string[];
	caption?: string;
	accountId?: string | null;
	scheduledAt?: Date | null;
	status?: "draft" | "queued";
};

export type PatchPostInput = {
	caption?: string;
	memeIds?: string[];
	scheduledAt?: Date | null;
	status?: "draft" | "queued" | "cancelled";
	altTexts?: (string | null)[];
};

export async function createPost(
	input: CreatePostInput,
	viewerId?: string,
): Promise<PostDetailDto> {
	const { memeIds, accountId, scheduledAt, status = "draft" } = input;

	return runSerializable(async (tx) => {
		// 1. Validate memes (1-10, all approved)
		if (memeIds.length < 1 || memeIds.length > 10) {
			throw unprocessable("A post must contain between 1 and 10 memes");
		}

		const memes = await tx.meme.findMany({
			where: { id: { in: memeIds } },
		});

		if (memes.length !== memeIds.length) {
			throw unprocessable("One or more memes not found");
		}

		const unapproved = memes.filter((m) => m.status !== "approved");
		if (unapproved.length > 0) {
			throw unprocessable("All memes in a post must be approved");
		}

		// 2. Check conflict: a meme in another non-cancelled post
		const conflicts = await tx.postItem.findMany({
			where: {
				memeId: { in: memeIds },
				post: { status: { not: "cancelled" } },
			},
			select: { memeId: true, postId: true },
		});

		if (conflicts.length > 0) {
			const c = conflicts[0];
			throw conflict(
				`Meme ${c?.memeId} is already in another active post (${c?.postId})`,
			);
		}

		// 3. Instagram account must exist when given
		if (accountId) {
			const account = await tx.instagramAccount.findUnique({
				where: { id: accountId },
			});
			if (!account) {
				throw notFound("Instagram account not found");
			}
		}

		// 4. Default caption to first meme's captionDraft
		const firstMeme = memes.find((m) => m.id === memeIds[0]);
		const finalCaption =
			input.caption !== undefined
				? input.caption
				: (firstMeme?.captionDraft ?? "");

		// 5. Kind
		const kind = memeIds.length > 1 ? "carousel" : "image";

		// 6. Queue position for unscheduled queued posts
		let queuePosition: number | null = null;
		if (status === "queued" && !scheduledAt) {
			const lastQueued = await tx.post.findFirst({
				where: { status: "queued", scheduledAt: null },
				orderBy: { queuePosition: "desc" },
				select: { queuePosition: true },
			});
			queuePosition = (lastQueued?.queuePosition ?? 0) + 1;
		}

		// 7. Create post with items
		const post = await tx.post.create({
			data: {
				kind,
				status,
				caption: finalCaption,
				accountId: accountId ?? null,
				scheduledAt: scheduledAt ?? null,
				queuePosition,
				createdById: viewerId ?? null,
				items: {
					create: memeIds.map((memeId, position) => ({
						memeId,
						position,
					})),
				},
			},
		});

		if (status === "queued") {
			await audit(
				{
					actorId: viewerId ?? null,
					action: "post.queue",
					subjectType: "post",
					subjectId: post.id,
				},
				tx,
			);
		}

		return fetchPostDetail(post.id, tx);
	});
}

export async function patchPost(
	id: string,
	input: PatchPostInput,
	viewerId?: string,
): Promise<PostDetailDto> {
	return runSerializable(async (tx) => {
		const post = await tx.post.findUnique({
			where: { id },
			include: { items: true },
		});

		if (!post) {
			throw notFound("Post not found");
		}

		// PATCH is 409 once publishing/published
		if (post.status === "publishing" || post.status === "published") {
			throw conflict("Cannot edit a post once publishing or published");
		}

		const dataToUpdate: Prisma.PostUpdateInput = {};

		if (input.caption !== undefined) {
			dataToUpdate.caption = input.caption;
		}

		// Anything that changes what Instagram would receive invalidates the
		// containers of an earlier attempt (they hold the old caption/images).
		const contentChanged =
			(input.caption !== undefined && input.caption !== post.caption) ||
			input.memeIds !== undefined ||
			input.altTexts !== undefined;
		if (contentChanged && post.containerIds.length > 0) {
			dataToUpdate.containerIds = [];
			dataToUpdate.containerAt = null;
		}

		if (input.scheduledAt !== undefined) {
			dataToUpdate.scheduledAt = input.scheduledAt;
			if (input.scheduledAt === null) {
				dataToUpdate.slot = { disconnect: true };
			}
		}

		if (input.status !== undefined) {
			dataToUpdate.status = input.status;
			if (input.status === "cancelled") {
				dataToUpdate.queuePosition = null;
			} else if (input.status === "queued" && post.status !== "queued") {
				if (post.status === "failed") {
					// Retry from failed: fresh attempt budget
					dataToUpdate.attempts = 0;
					dataToUpdate.error = null;
				}
				const effectiveScheduledAt =
					input.scheduledAt !== undefined
						? input.scheduledAt
						: post.scheduledAt;
				if (
					input.scheduledAt === undefined &&
					effectiveScheduledAt &&
					effectiveScheduledAt.getTime() <= Date.now()
				) {
					// A stale slot from an earlier life: take the next free slot
					dataToUpdate.scheduledAt = null;
					dataToUpdate.slot = { disconnect: true };
				}
				if (!effectiveScheduledAt || dataToUpdate.scheduledAt === null) {
					const lastQueued = await tx.post.findFirst({
						where: { status: "queued", scheduledAt: null },
						orderBy: { queuePosition: "desc" },
						select: { queuePosition: true },
					});
					dataToUpdate.queuePosition = (lastQueued?.queuePosition ?? 0) + 1;
				}
			}
		}

		// If memeIds is provided, replace the items in order
		if (input.memeIds !== undefined) {
			const { memeIds } = input;
			if (memeIds.length < 1 || memeIds.length > 10) {
				throw unprocessable("A post must contain between 1 and 10 memes");
			}

			const memes = await tx.meme.findMany({
				where: { id: { in: memeIds } },
			});
			if (memes.length !== memeIds.length) {
				throw unprocessable("One or more memes not found");
			}

			const unapproved = memes.filter((m) => m.status !== "approved");
			if (unapproved.length > 0) {
				throw unprocessable("All memes in a post must be approved");
			}

			// Check conflicts excluding this post
			const conflicts = await tx.postItem.findMany({
				where: {
					memeId: { in: memeIds },
					postId: { not: id },
					post: { status: { not: "cancelled" } },
				},
				select: { memeId: true, postId: true },
			});

			if (conflicts.length > 0) {
				const c = conflicts[0];
				throw conflict(
					`Meme ${c?.memeId} is already in another active post (${c?.postId})`,
				);
			}

			dataToUpdate.kind = memeIds.length > 1 ? "carousel" : "image";

			// Replace items
			await tx.postItem.deleteMany({ where: { postId: id } });
			await tx.postItem.createMany({
				data: memeIds.map((memeId, position) => ({
					postId: id,
					memeId,
					position,
					altText: input.altTexts?.[position] ?? null,
				})),
			});
		} else if (input.altTexts !== undefined) {
			// Update alt texts on existing items
			for (let i = 0; i < input.altTexts.length; i++) {
				const alt = input.altTexts[i];
				await tx.postItem.updateMany({
					where: { postId: id, position: i },
					data: { altText: alt ?? null },
				});
			}
		}

		// Bringing a cancelled post back: its memes may have joined another
		// post (or been unapproved) while it was cancelled.
		if (
			post.status === "cancelled" &&
			(input.status === "draft" || input.status === "queued") &&
			input.memeIds === undefined
		) {
			const memeIds = post.items.map((i) => i.memeId);
			const taken = await tx.postItem.findFirst({
				where: {
					memeId: { in: memeIds },
					postId: { not: id },
					post: { status: { not: "cancelled" } },
				},
				select: { memeId: true, postId: true },
			});
			if (taken) {
				throw conflict(
					`Meme ${taken.memeId} is already in another active post (${taken.postId})`,
				);
			}
			const unapproved = await tx.meme.count({
				where: { id: { in: memeIds }, status: { not: "approved" } },
			});
			if (unapproved > 0) {
				throw unprocessable("All memes in a post must be approved");
			}
		}

		await tx.post.update({
			where: { id },
			data: dataToUpdate,
		});

		// Audit status transitions
		if (input.status === "cancelled" && post.status !== "cancelled") {
			await audit(
				{
					actorId: viewerId ?? null,
					action: "post.cancel",
					subjectType: "post",
					subjectId: id,
				},
				tx,
			);
		} else if (input.status === "queued" && post.status !== "queued") {
			await audit(
				{
					actorId: viewerId ?? null,
					action: "post.queue",
					subjectType: "post",
					subjectId: id,
				},
				tx,
			);
		}

		return fetchPostDetail(id, tx);
	});
}

export async function publishNow(
	id: string,
	viewerId?: string,
): Promise<PostDetailDto> {
	const post = await db().post.findUnique({
		where: { id },
	});

	if (!post) {
		throw notFound("Post not found");
	}

	// queued or draft -> queued with scheduledAt = now, enqueue instagram.publish; 409 otherwise
	if (post.status !== "draft" && post.status !== "queued") {
		throw conflict(`Cannot publish-now a post with status ${post.status}`);
	}

	// Conditional on the status we just saw: the publisher may have claimed the
	// post in the meantime, and moving a publishing post back to queued would
	// let a second job publish it again.
	const moved = await db().post.updateMany({
		where: { id, status: { in: ["draft", "queued"] } },
		data: {
			status: "queued",
			scheduledAt: new Date(),
			queuePosition: null,
		},
	});
	if (moved.count === 0) {
		throw conflict("Post is already being published");
	}

	await enqueue(instagramPublish, { postId: id }, { singletonKey: id });

	await audit({
		actorId: viewerId ?? null,
		action: "post.publish-now",
		subjectType: "post",
		subjectId: id,
	});

	return getPost(id);
}

export async function reorderPosts(ids: string[]): Promise<void> {
	if (ids.length === 0) return;

	await db().$transaction(async (tx) => {
		const posts = await tx.post.findMany({
			where: { id: { in: ids } },
			select: { id: true, status: true, scheduledAt: true },
		});

		if (posts.length !== ids.length) {
			throw notFound("One or more posts in reorder list not found");
		}

		// Only unscheduled queued posts can have their queue position reordered
		for (const p of posts) {
			if (p.status !== "queued" || p.scheduledAt !== null) {
				throw conflict("Only unscheduled queued posts can be reordered");
			}
		}

		// Listed posts first, then any other unscheduled queued posts in their
		// current order, so positions never collide.
		const others = await tx.post.findMany({
			where: { status: "queued", scheduledAt: null, id: { notIn: ids } },
			orderBy: [{ queuePosition: "asc" }, { createdAt: "asc" }],
			select: { id: true },
		});
		const order = [...ids, ...others.map((o) => o.id)];
		for (let i = 0; i < order.length; i++) {
			const postId = order[i];
			if (postId) {
				await tx.post.update({
					where: { id: postId },
					data: { queuePosition: i + 1 },
				});
			}
		}
	});
}

export type ListPostsQuery = {
	status?:
		| "draft"
		| "queued"
		| "publishing"
		| "published"
		| "failed"
		| "cancelled";
	from?: Date;
	to?: Date;
	cursor?: string;
	limit?: number;
};

export async function listPosts(query: ListPostsQuery): Promise<{
	items: PostSummaryDto[];
	nextCursor: string | null;
}> {
	const { status, from, to, cursor, limit = 50 } = query;

	const where: Prisma.PostWhereInput = {};
	if (status) {
		where.status = status;
	}
	if (from || to) {
		where.scheduledAt = {
			...(from ? { gte: from } : {}),
			...(to ? { lte: to } : {}),
		};
	}

	let orderBy: Prisma.PostOrderByWithRelationInput[] = [{ createdAt: "desc" }];
	if (status === "queued") {
		orderBy = [{ queuePosition: "asc" }, { createdAt: "asc" }];
	}

	const rows = await db().post.findMany({
		where,
		take: limit + 1,
		...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
		orderBy,
		include: {
			items: {
				orderBy: { position: "asc" },
				select: { memeId: true },
			},
		},
	});

	let nextCursor: string | null = null;
	let items = rows;
	if (rows.length > limit) {
		const nextItem = rows[limit];
		nextCursor = nextItem?.id ?? null;
		items = rows.slice(0, limit);
	}

	const summaries: PostSummaryDto[] = items.map((p) => {
		const firstItem = p.items[0];
		return {
			id: p.id,
			accountId: p.accountId,
			kind: p.kind,
			status: p.status,
			caption: p.caption,
			queuePosition: p.queuePosition,
			scheduledAt: p.scheduledAt?.toISOString() ?? null,
			publishedAt: p.publishedAt?.toISOString() ?? null,
			permalink: p.permalink,
			error: p.error,
			thumbUrl: firstItem ? `/api/memes/${firstItem.memeId}/media/thumb` : null,
			itemCount: p.items.length,
			createdAt: p.createdAt.toISOString(),
			updatedAt: p.updatedAt.toISOString(),
		};
	});

	return { items: summaries, nextCursor };
}

export async function getPost(id: string): Promise<PostDetailDto> {
	return fetchPostDetail(id, db());
}

async function fetchPostDetail(
	id: string,
	client: Pick<Prisma.TransactionClient, "post" | "user"> = db(),
): Promise<PostDetailDto> {
	const post = await client.post.findUnique({
		where: { id },
		include: {
			items: {
				orderBy: { position: "asc" },
				include: {
					meme: {
						include: {
							tags: {
								include: { tag: true },
							},
						},
					},
				},
			},
		},
	});

	if (!post) {
		throw notFound("Post not found");
	}

	let createdBy: UserRefDto | null = null;
	if (post.createdById) {
		const u = await client.user.findUnique({
			where: { id: post.createdById },
			select: { id: true, username: true, email: true },
		});
		if (u) {
			createdBy = { id: u.id, username: u.username, email: u.email };
		}
	}

	const postItems: PostItemDto[] = post.items.map((item) => {
		const m = item.meme;
		const memeSummary: MemeSummaryDto = {
			id: m.id,
			source: m.source,
			status: m.status,
			width: m.width,
			height: m.height,
			blurhash: m.blurhash,
			takenAt: m.takenAt?.toISOString() ?? null,
			description: m.description,
			template: m.template,
			postability: m.postability,
			rating: m.rating,
			tags: m.tags.map((t) => ({
				name: t.tag.name,
				kind: t.tag.kind,
				source: t.source,
			})),
			sensitivity: (m.sensitivity as Sensitivity | null) ?? null,
			hasAttribution: Boolean(m.attributionId || m.creditText),
			creditText: m.creditText,
			duplicateOfId: m.duplicateOfId,
			renditionsReady: m.renditionsReady,
			postId: post.id,
			postStatus: post.status,
			thumbUrl: `/api/memes/${m.id}/media/thumb`,
			createdAt: m.createdAt.toISOString(),
			updatedAt: m.updatedAt.toISOString(),
		};

		return {
			position: item.position,
			altText: item.altText,
			meme: memeSummary,
		};
	});

	// Render caption and warnings
	const { text: renderedCaption, warnings: captionWarnings } =
		await renderCaption({
			caption: post.caption,
			items: post.items.map((i) => ({
				meme: {
					creditText: i.meme.creditText,
					hashtags: i.meme.hashtags,
					sensitivity: i.meme.sensitivity,
				},
			})),
		});

	const firstItem = post.items[0];

	return {
		id: post.id,
		accountId: post.accountId,
		kind: post.kind,
		status: post.status,
		caption: post.caption,
		queuePosition: post.queuePosition,
		scheduledAt: post.scheduledAt?.toISOString() ?? null,
		publishedAt: post.publishedAt?.toISOString() ?? null,
		permalink: post.permalink,
		error: post.error,
		thumbUrl: firstItem ? `/api/memes/${firstItem.memeId}/media/thumb` : null,
		itemCount: post.items.length,
		createdAt: post.createdAt.toISOString(),
		updatedAt: post.updatedAt.toISOString(),
		items: postItems,
		attempts: post.attempts,
		igMediaId: post.igMediaId,
		renderedCaption,
		captionWarnings,
		createdBy,
	};
}
