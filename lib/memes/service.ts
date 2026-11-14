import { assertAiAvailable } from "@/lib/ai";
import type {
	MemeDetailDto,
	MemeSummaryDto,
	Paged,
	UserRefDto,
} from "@/lib/api/types";
import { requestAttribution } from "@/lib/attribution/request";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
	badRequest,
	conflict,
	notFound,
	unprocessable,
} from "@/lib/http/errors";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { enqueue } from "@/lib/jobs/queue";
import { deleteObjects, memeKey } from "@/lib/s3";
import { presentMemeDetail, presentMemeSummary } from "./present";
import type {
	MemeBulkInput,
	MemeListParsedQuery,
	MemePatchInput,
} from "./schema";

const AI_FIELDS = [
	"description",
	"altText",
	"captionDraft",
	"hashtags",
	"template",
] as const;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id can never exist; answer 404 instead of letting Postgres 500 on the uuid cast. */
function assertMemeId(id: string): void {
	if (!UUID_RE.test(id)) {
		throw notFound("Meme not found");
	}
}

export function encodeCursor(sortVal: unknown, id: string): string {
	return Buffer.from(JSON.stringify([sortVal, id])).toString("base64url");
}

export function decodeCursor(cursor: string): [unknown, string] | null {
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf-8"),
		);
		if (
			Array.isArray(parsed) &&
			parsed.length === 2 &&
			typeof parsed[1] === "string"
		) {
			return [parsed[0], parsed[1]];
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Cross-slice contract: the attribution slice calls this.
 * Throws 404 if the meme is missing.
 */
export async function getMemeDetail(id: string): Promise<MemeDetailDto> {
	assertMemeId(id);
	const meme = await db().meme.findUnique({
		where: { id },
		include: {
			tags: { include: { tag: true } },
			postItems: {
				include: {
					post: {
						include: {
							items: { select: { memeId: true, position: true } },
						},
					},
				},
			},
			immichAsset: { select: { immichId: true } },
			analyses: { orderBy: { createdAt: "desc" } },
			candidates: { orderBy: { rank: "asc" } },
			attribution: true,
			duplicates: {
				include: {
					tags: { include: { tag: true } },
					postItems: { include: { post: true } },
				},
				orderBy: { createdAt: "desc" },
			},
		},
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	let approvedUser: UserRefDto | null = null;
	if (meme.approvedById) {
		const u = await db().user.findUnique({
			where: { id: meme.approvedById },
			select: { id: true, email: true, username: true },
		});
		if (u) approvedUser = u;
	}

	return presentMemeDetail({ ...meme, approvedUser });
}

export async function listMemes(
	query: MemeListParsedQuery,
): Promise<Paged<MemeSummaryDto>> {
	const limit = query.limit ?? 60;
	const sort = query.sort ?? "newest";

	// 1. Base status filter: default view is status ≠ rejected, archived
	const where: Prisma.MemeWhereInput = {};
	if (query.status) {
		where.status = query.status;
	} else {
		where.status = { notIn: ["rejected", "archived"] };
	}

	// 2. Tag filter
	if (query.tag) {
		where.tags = {
			some: {
				tag: { name: query.tag.toLowerCase().trim() },
			},
		};
	}

	// 3. Template filter
	if (query.template) {
		where.template = { equals: query.template, mode: "insensitive" };
	}

	// 4. Postability filter
	if (query.minPostability !== undefined) {
		where.postability = { gte: query.minPostability };
	}

	// 5. Sensitive filter: true = any flag set; false = none set
	if (query.sensitive === true) {
		where.OR = [
			{ sensitivity: { path: ["nsfw"], equals: true } },
			{ sensitivity: { path: ["politics"], equals: true } },
			{ sensitivity: { path: ["slurs"], equals: true } },
			{ sensitivity: { path: ["personalData"], equals: true } },
		];
	} else if (query.sensitive === false) {
		// "No flag set" cannot be written with NOT(path = true): a missing key
		// makes that comparison NULL and the row drops out. Ask Postgres for the
		// flagged ids and exclude them instead.
		const flagged = await db().$queryRaw<Array<{ id: string }>>`
			SELECT id FROM memes
			WHERE sensitivity->>'nsfw' = 'true'
				OR sensitivity->>'politics' = 'true'
				OR sensitivity->>'slurs' = 'true'
				OR sensitivity->>'personalData' = 'true'
		`;
		where.AND = [{ id: { notIn: flagged.map((f) => f.id) } }];
	}

	// 6. hasAttribution filter
	if (query.hasAttribution === true) {
		where.attributionId = { not: null };
	} else if (query.hasAttribution === false) {
		where.attributionId = null;
	}

	// 7. Duplicates filter
	if (query.duplicates === true) {
		where.duplicateOfId = { not: null };
	} else if (query.duplicates === false) {
		where.duplicateOfId = null;
	}

	// 8. Full-text search (q)
	let matchingRanks: Map<string, number> | null = null;
	let rankedMatches: { id: string; rank: number }[] = [];
	if (query.q) {
		// The generated column stems description/alt_text with 'english' and
		// leaves template/ocr_text unstemmed ('simple'), so the query has to be
		// parsed both ways or "cats" never finds a description saying "cat".
		// websearch_to_tsquery never raises on odd input; the term is a bound
		// parameter, never interpolated.
		const rawMatches = await db().$queryRaw<
			Array<{ id: string; rank: number }>
		>`
			WITH q AS (
				SELECT websearch_to_tsquery('simple', ${query.q}) || websearch_to_tsquery('english', ${query.q}) AS tsq
			)
			SELECT m.id, ts_rank(m."search", q.tsq) AS rank
			FROM memes m, q
			WHERE m."search" @@ q.tsq
			ORDER BY rank DESC, m.id DESC
		`;
		if (rawMatches.length === 0) {
			return { items: [], nextCursor: null };
		}
		rankedMatches = rawMatches.map((r) => ({ id: r.id, rank: Number(r.rank) }));
		matchingRanks = new Map(rankedMatches.map((r) => [r.id, r.rank]));
		where.id = { in: Array.from(matchingRanks.keys()) };
	}

	// 9. Relevance sorting
	if (sort === "relevance" && matchingRanks) {
		// Filter ranked matches by the other criteria
		const candidateMemes = await db().meme.findMany({
			where,
			select: { id: true },
		});
		const candidateSet = new Set(candidateMemes.map((m) => m.id));
		const validRanked = rankedMatches.filter((m) => candidateSet.has(m.id));

		let startIndex = 0;
		if (query.cursor) {
			const decoded = decodeCursor(query.cursor);
			if (decoded) {
				const [cursorRank, cursorId] = decoded;
				const cRank = Number(cursorRank);
				const idx = validRanked.findIndex(
					(m) => m.rank < cRank || (m.rank === cRank && m.id < cursorId),
				);
				startIndex = idx >= 0 ? idx : validRanked.length;
			}
		}

		const pageSlice = validRanked.slice(startIndex, startIndex + limit + 1);
		const hasMore = pageSlice.length > limit;
		const pageItems = hasMore ? pageSlice.slice(0, limit) : pageSlice;

		if (pageItems.length === 0) {
			return { items: [], nextCursor: null };
		}

		const ids = pageItems.map((p) => p.id);
		const fullMemes = await db().meme.findMany({
			where: { id: { in: ids } },
			include: {
				tags: { include: { tag: true } },
				postItems: {
					where: { post: { status: { not: "cancelled" } } },
					include: { post: true },
				},
			},
		});

		const fullMemesMap = new Map(fullMemes.map((m) => [m.id, m]));
		const sortedMemes: MemeSummaryDto[] = [];
		for (const id of ids) {
			const m = fullMemesMap.get(id);
			if (m) {
				sortedMemes.push(presentMemeSummary(m));
			}
		}

		let nextCursor: string | null = null;
		if (hasMore && pageItems.length > 0) {
			const lastItem = pageItems[pageItems.length - 1];
			if (lastItem) {
				nextCursor = encodeCursor(lastItem.rank, lastItem.id);
			}
		}

		return { items: sortedMemes, nextCursor };
	}

	// 10. Standard sorting & cursor pagination for non-relevance sorts
	const cursorParsed = query.cursor ? decodeCursor(query.cursor) : null;
	const cursorConditions: Prisma.MemeWhereInput[] = [];

	let orderBy: Prisma.MemeOrderByWithRelationInput[];

	switch (sort) {
		case "oldest":
			orderBy = [{ createdAt: "asc" }, { id: "asc" }];
			if (cursorParsed) {
				const [cDate, cId] = cursorParsed;
				const date = new Date(String(cDate));
				cursorConditions.push({
					OR: [
						{ createdAt: { gt: date } },
						{ createdAt: date, id: { gt: cId } },
					],
				});
			}
			break;

		case "postability":
			orderBy = [
				{ postability: { sort: "desc", nulls: "last" } },
				{ id: "desc" },
			];
			if (cursorParsed) {
				const [cVal, cId] = cursorParsed;
				if (cVal === null) {
					cursorConditions.push({
						postability: null,
						id: { lt: cId },
					});
				} else {
					const num = Number(cVal);
					cursorConditions.push({
						OR: [
							{ postability: { lt: num } },
							{ postability: num, id: { lt: cId } },
							{ postability: null },
						],
					});
				}
			}
			break;

		case "takenAt":
			orderBy = [{ takenAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
			if (cursorParsed) {
				const [cVal, cId] = cursorParsed;
				if (cVal === null) {
					cursorConditions.push({
						takenAt: null,
						id: { lt: cId },
					});
				} else {
					const date = new Date(String(cVal));
					cursorConditions.push({
						OR: [
							{ takenAt: { lt: date } },
							{ takenAt: date, id: { lt: cId } },
							{ takenAt: null },
						],
					});
				}
			}
			break;

		case "rating":
			orderBy = [{ rating: { sort: "desc", nulls: "last" } }, { id: "desc" }];
			if (cursorParsed) {
				const [cVal, cId] = cursorParsed;
				if (cVal === null) {
					cursorConditions.push({
						rating: null,
						id: { lt: cId },
					});
				} else {
					const num = Number(cVal);
					cursorConditions.push({
						OR: [
							{ rating: { lt: num } },
							{ rating: num, id: { lt: cId } },
							{ rating: null },
						],
					});
				}
			}
			break;

		default:
			orderBy = [{ createdAt: "desc" }, { id: "desc" }];
			if (cursorParsed) {
				const [cDate, cId] = cursorParsed;
				const date = new Date(String(cDate));
				cursorConditions.push({
					OR: [
						{ createdAt: { lt: date } },
						{ createdAt: date, id: { lt: cId } },
					],
				});
			}
			break;
	}

	const finalWhere: Prisma.MemeWhereInput =
		cursorConditions.length > 0 ? { AND: [where, ...cursorConditions] } : where;

	const rows = await db().meme.findMany({
		where: finalWhere,
		orderBy,
		take: limit + 1,
		include: {
			tags: { include: { tag: true } },
			postItems: {
				where: { post: { status: { not: "cancelled" } } },
				include: { post: true },
			},
		},
	});

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;

	let nextCursor: string | null = null;
	if (hasMore && items.length > 0) {
		const last = items[items.length - 1];
		if (last) {
			let sortVal: unknown;
			switch (sort) {
				case "oldest":
				case "newest":
					sortVal = last.createdAt.toISOString();
					break;
				case "postability":
					sortVal = last.postability;
					break;
				case "takenAt":
					sortVal = last.takenAt?.toISOString() ?? null;
					break;
				case "rating":
					sortVal = last.rating;
					break;
			}
			nextCursor = encodeCursor(sortVal, last.id);
		}
	}

	return {
		items: items.map(presentMemeSummary),
		nextCursor,
	};
}

export async function patchMeme(
	id: string,
	input: MemePatchInput,
	user: Viewer,
): Promise<MemeDetailDto> {
	assertMemeId(id);
	const meme = await db().meme.findUnique({
		where: { id },
		select: {
			id: true,
			status: true,
			userEdited: true,
			approvedById: true,
			approvedAt: true,
			description: true,
			altText: true,
			captionDraft: true,
			hashtags: true,
			template: true,
		},
	});

	if (!meme) {
		throw notFound("Meme not found");
	}

	// duplicateOfId validation: cannot be own duplicate
	if (input.duplicateOfId !== undefined) {
		if (input.duplicateOfId === id) {
			throw unprocessable("A meme cannot be a duplicate of itself");
		}
		if (input.duplicateOfId !== null) {
			const target = await db().meme.findUnique({
				where: { id: input.duplicateOfId },
				select: { id: true },
			});
			if (!target) {
				throw notFound("Target duplicate meme not found");
			}
		}
	}

	await db().$transaction(async (tx) => {
		// 409: a rejected or archived meme must not sit in a queued or draft post
		if (input.status === "rejected" || input.status === "archived") {
			const inActivePost = await tx.postItem.findFirst({
				where: {
					memeId: id,
					post: { status: { in: ["draft", "queued", "publishing"] } },
				},
			});
			if (inActivePost) {
				throw conflict("Cannot reject or archive a meme in an active post");
			}
		}

		// Track user-edited AI fields: only a real change counts, so tabbing
		// through the form never freezes a field against re-analysis.
		const userEdited = new Set(meme.userEdited);
		for (const field of AI_FIELDS) {
			const next = input[field];
			if (next === undefined) continue;
			const current = meme[field];
			const same = Array.isArray(next)
				? Array.isArray(current) &&
					next.length === current.length &&
					next.every((v, i) => v === current[i])
				: next === current;
			if (!same) userEdited.add(field);
		}

		// Tags update: replaces user tags and leaves AI tags alone
		if (input.tags !== undefined) {
			const targetTagNames = Array.from(
				new Set(input.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)),
			);

			const tagRows = await Promise.all(
				targetTagNames.map((name) =>
					tx.tag.upsert({
						where: { name },
						update: {},
						create: { name, kind: "user" },
					}),
				),
			);
			const targetTagIds = new Set(tagRows.map((t) => t.id));

			const existingUserMemeTags = await tx.memeTag.findMany({
				where: { memeId: id, source: "user" },
				select: { tagId: true },
			});

			const toDelete = existingUserMemeTags
				.filter((mt) => !targetTagIds.has(mt.tagId))
				.map((mt) => mt.tagId);

			if (toDelete.length > 0) {
				await tx.memeTag.deleteMany({
					where: { memeId: id, tagId: { in: toDelete }, source: "user" },
				});
			}

			const allCurrentTags = await tx.memeTag.findMany({
				where: { memeId: id },
				select: { tagId: true },
			});
			const existingTagIds = new Set(allCurrentTags.map((mt) => mt.tagId));

			for (const tag of tagRows) {
				if (!existingTagIds.has(tag.id)) {
					await tx.memeTag.create({
						data: { memeId: id, tagId: tag.id, source: "user" },
					});
				}
			}
		}

		// Status transitions & auditing
		let approvedById = meme.approvedById;
		let approvedAt = meme.approvedAt;
		if (input.status === "approved" && meme.status !== "approved") {
			approvedById = user.id;
			approvedAt = new Date();
		}

		await tx.meme.update({
			where: { id },
			data: {
				...(input.status !== undefined
					? { status: input.status, approvedById, approvedAt }
					: {}),
				...(input.rating !== undefined ? { rating: input.rating } : {}),
				...(input.notes !== undefined ? { notes: input.notes } : {}),
				...(input.description !== undefined
					? { description: input.description }
					: {}),
				...(input.altText !== undefined ? { altText: input.altText } : {}),
				...(input.captionDraft !== undefined
					? { captionDraft: input.captionDraft }
					: {}),
				...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
				...(input.template !== undefined ? { template: input.template } : {}),
				...(input.creditText !== undefined
					? { creditText: input.creditText }
					: {}),
				...(input.duplicateOfId !== undefined
					? { duplicateOfId: input.duplicateOfId }
					: {}),
				userEdited: Array.from(userEdited),
			},
		});

		if (input.status && input.status !== meme.status) {
			const action =
				input.status === "approved"
					? "meme.approve"
					: input.status === "rejected"
						? "meme.reject"
						: input.status === "archived"
							? "meme.archive"
							: `meme.${input.status}`;
			await audit(
				{
					actorId: user.id,
					action,
					subjectType: "meme",
					subjectId: id,
					data: { from: meme.status, to: input.status },
				},
				tx,
			);
		}
	});

	return getMemeDetail(id);
}

export async function bulkMemes(
	input: MemeBulkInput,
	user: Viewer,
): Promise<{ updated: number }> {
	// Unknown ids are ignored (they would otherwise fail foreign keys halfway
	// through, or write audit rows for memes that do not exist).
	const ids = (
		await db().meme.findMany({
			where: { id: { in: input.ids } },
			select: { id: true },
		})
	).map((m) => m.id);
	if (ids.length === 0) {
		return { updated: 0 };
	}

	switch (input.action) {
		case "approve":
			return db().$transaction(async (tx) => {
				// Already-approved memes keep their original approver and time.
				const targets = (
					await tx.meme.findMany({
						where: { id: { in: ids }, status: { not: "approved" } },
						select: { id: true },
					})
				).map((m) => m.id);
				if (targets.length === 0) return { updated: 0 };
				const res = await tx.meme.updateMany({
					where: { id: { in: targets } },
					data: {
						status: "approved",
						approvedById: user.id,
						approvedAt: new Date(),
					},
				});
				for (const id of targets) {
					await audit(
						{
							actorId: user.id,
							action: "meme.approve",
							subjectType: "meme",
							subjectId: id,
						},
						tx,
					);
				}
				return { updated: res.count };
			});

		case "reject":
		case "archive": {
			const targetStatus = input.action === "reject" ? "rejected" : "archived";
			return db().$transaction(async (tx) => {
				const inActivePost = await tx.postItem.findFirst({
					where: {
						memeId: { in: ids },
						post: { status: { in: ["draft", "queued", "publishing"] } },
					},
				});
				if (inActivePost) {
					throw conflict(
						`Cannot ${input.action} memes that are in a draft or queued post`,
					);
				}
				const targets = (
					await tx.meme.findMany({
						where: { id: { in: ids }, status: { not: targetStatus } },
						select: { id: true },
					})
				).map((m) => m.id);
				if (targets.length === 0) return { updated: 0 };
				const res = await tx.meme.updateMany({
					where: { id: { in: targets } },
					data: { status: targetStatus },
				});
				const action =
					input.action === "reject" ? "meme.reject" : "meme.archive";
				for (const id of targets) {
					await audit(
						{
							actorId: user.id,
							action,
							subjectType: "meme",
							subjectId: id,
						},
						tx,
					);
				}
				return { updated: res.count };
			});
		}

		case "tag": {
			if (!input.tag?.trim()) {
				throw badRequest("Tag name is required for tag action");
			}
			const tagName = input.tag.toLowerCase().trim();
			return db().$transaction(async (tx) => {
				const tag = await tx.tag.upsert({
					where: { name: tagName },
					update: {},
					create: { name: tagName, kind: "user" },
				});
				const existing = await tx.memeTag.findMany({
					where: { memeId: { in: ids }, tagId: tag.id },
					select: { memeId: true },
				});
				const alreadyTagged = new Set(existing.map((e) => e.memeId));
				const toAdd = ids.filter((id) => !alreadyTagged.has(id));
				if (toAdd.length > 0) {
					await tx.memeTag.createMany({
						data: toAdd.map((memeId) => ({
							memeId,
							tagId: tag.id,
							source: "user" as const,
						})),
						skipDuplicates: true,
					});
				}
				return { updated: toAdd.length };
			});
		}

		case "untag": {
			if (!input.tag?.trim()) {
				throw badRequest("Tag name is required for untag action");
			}
			const tagName = input.tag.toLowerCase().trim();
			return db().$transaction(async (tx) => {
				const tag = await tx.tag.findUnique({ where: { name: tagName } });
				if (!tag) {
					return { updated: 0 };
				}
				const res = await tx.memeTag.deleteMany({
					where: {
						memeId: { in: ids },
						tagId: tag.id,
						source: "user",
					},
				});
				return { updated: res.count };
			});
		}

		case "analyze": {
			// Same preconditions and rows as POST /memes/{id}/analyses: 503/429
			// when AI is off or the budget is spent, and a queued Analysis the
			// UI can show.
			await assertAiAvailable();
			const running = await db().analysis.findMany({
				where: {
					memeId: { in: ids },
					kind: "meme",
					status: { in: ["queued", "running"] },
				},
				select: { memeId: true },
			});
			const busySet = new Set(running.map((r) => r.memeId).filter(Boolean));
			const eligible = ids.filter((id) => !busySet.has(id));
			for (const memeId of eligible) {
				const analysis = await db().analysis.create({
					data: {
						memeId,
						kind: "meme",
						status: "queued",
						model: env().OPENROUTER_ANALYSIS_MODEL,
					},
				});
				await enqueue(analysisMeme, { memeId, analysisId: analysis.id });
			}
			return { updated: eligible.length };
		}

		case "attribute": {
			await assertAiAvailable();
			const running = await db().analysis.findMany({
				where: {
					memeId: { in: ids },
					kind: "attribution",
					status: { in: ["queued", "running"] },
				},
				select: { memeId: true },
			});
			const busySet = new Set(running.map((r) => r.memeId).filter(Boolean));
			const eligible = ids.filter((id) => !busySet.has(id));
			for (const memeId of eligible) {
				await requestAttribution(memeId, user.id);
			}
			return { updated: eligible.length };
		}
	}
}

export async function deleteMeme(id: string, user: Viewer): Promise<void> {
	requireAdmin(user);
	assertMemeId(id);

	const meme = await db().meme.findUnique({
		where: { id },
		select: { id: true, contentType: true, sha256: true },
	});
	if (!meme) {
		throw notFound("Meme not found");
	}

	const inPost = await db().postItem.findFirst({
		where: {
			memeId: id,
			post: { status: { in: ["published", "queued", "publishing"] } },
		},
	});
	if (inPost) {
		throw conflict(
			"Cannot delete a meme that is in a published, queued or publishing post",
		);
	}

	// Database first: if the transaction fails nothing is lost. The bucket is
	// versioned, so a failed S3 cleanup afterwards only leaves removable
	// orphans, never a meme row whose image is gone.
	await db().$transaction(async (tx) => {
		// Clean up post items in draft, failed or cancelled posts (the foreign key
		// is onDelete: Restrict)
		await tx.postItem.deleteMany({ where: { memeId: id } });
		await tx.meme.delete({ where: { id } });
		await audit(
			{
				actorId: user.id,
				action: "meme.delete",
				subjectType: "meme",
				subjectId: id,
				data: { sha256: meme.sha256 },
			},
			tx,
		);
	});

	try {
		await deleteObjects([
			memeKey(meme.id, "original", meme.contentType),
			memeKey(meme.id, "display"),
			memeKey(meme.id, "thumb"),
		]);
	} catch (err) {
		// The meme is already gone; report success and leave the orphans to the
		// bucket lifecycle rather than a 500 for a delete that happened.
		console.error(`meme ${id} deleted but S3 cleanup failed`, err);
	}
}
