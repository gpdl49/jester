import { beforeEach, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import {
	bulkMemes,
	deleteMeme,
	getMemeDetail,
	listMemes,
	patchMeme,
} from "@/lib/memes/service";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme, createPost } from "@/test/helpers/factories";
import { TEST_USER } from "@/test/helpers/http";
import { installFakeS3 } from "@/test/helpers/s3";
import { ADMIN_USER } from "@/test/helpers/users";

const testViewer: Viewer = {
	...TEST_USER,
	id: "00000000-0000-0000-0000-000000000001",
	isAdmin: false,
};

const adminViewer: Viewer = {
	...ADMIN_USER,
	id: "00000000-0000-0000-0000-000000000002",
	isAdmin: true,
};

describeWithDb("memes service", () => {
	beforeEach(async () => {
		await resetDb();
		await db().user.createMany({
			data: [
				{
					id: testViewer.id,
					sub: testViewer.sub,
					email: testViewer.email,
					username: testViewer.username,
				},
				{
					id: adminViewer.id,
					sub: adminViewer.sub,
					email: adminViewer.email,
					username: adminViewer.username,
				},
			],
			skipDuplicates: true,
		});
	});

	describe("listMemes query building", () => {
		it("default view excludes rejected and archived memes", async () => {
			await createMeme({ status: "inbox" });
			await createMeme({ status: "approved" });
			await createMeme({ status: "rejected" });
			await createMeme({ status: "archived" });

			const result = await listMemes({ limit: 60, sort: "newest" });
			expect(result.items).toHaveLength(2);
			const statuses = result.items.map((i) => i.status);
			expect(statuses).toContain("inbox");
			expect(statuses).toContain("approved");
			expect(statuses).not.toContain("rejected");
			expect(statuses).not.toContain("archived");
		});

		it("filters by explicit status", async () => {
			await createMeme({ status: "inbox" });
			await createMeme({ status: "rejected" });

			const rejected = await listMemes({
				status: "rejected",
				limit: 60,
				sort: "newest",
			});
			expect(rejected.items).toHaveLength(1);
			expect(rejected.items[0]?.status).toBe("rejected");
		});

		it("filters by tag name", async () => {
			const m1 = await createMeme({ description: "m1" });
			const _m2 = await createMeme({ description: "m2" });
			const tag = await db().tag.create({
				data: { name: "cats", kind: "topic" },
			});
			await db().memeTag.create({
				data: { memeId: m1.id, tagId: tag.id, source: "ai" },
			});

			const res = await listMemes({ tag: "cats", limit: 60, sort: "newest" });
			expect(res.items).toHaveLength(1);
			expect(res.items[0]?.id).toBe(m1.id);
		});

		it("filters by template", async () => {
			await createMeme({ template: "drake" });
			await createMeme({ template: "doge" });

			const res = await listMemes({
				template: "drake",
				limit: 60,
				sort: "newest",
			});
			expect(res.items).toHaveLength(1);
			expect(res.items[0]?.template).toBe("drake");
		});

		it("filters by minPostability", async () => {
			await createMeme({ postability: 80 });
			await createMeme({ postability: 40 });
			await createMeme({ postability: null });

			const res = await listMemes({
				minPostability: 70,
				limit: 60,
				sort: "newest",
			});
			expect(res.items).toHaveLength(1);
			expect(res.items[0]?.postability).toBe(80);
		});

		it("filters by sensitive flag (true and false)", async () => {
			const safeMeme = await createMeme({
				sensitivity: {
					nsfw: false,
					politics: false,
					slurs: false,
					personalData: false,
					notes: null,
				},
			});
			const nsfwMeme = await createMeme({
				sensitivity: {
					nsfw: true,
					politics: false,
					slurs: false,
					personalData: false,
					notes: null,
				},
			});
			const nullSensMeme = await createMeme({ sensitivity: undefined });

			const sensitiveOnly = await listMemes({
				sensitive: true,
				limit: 60,
				sort: "newest",
			});
			expect(sensitiveOnly.items.map((i) => i.id)).toEqual([nsfwMeme.id]);

			const safeOnly = await listMemes({
				sensitive: false,
				limit: 60,
				sort: "newest",
			});
			expect(safeOnly.items.map((i) => i.id)).toContain(safeMeme.id);
			expect(safeOnly.items.map((i) => i.id)).toContain(nullSensMeme.id);
			expect(safeOnly.items.map((i) => i.id)).not.toContain(nsfwMeme.id);
		});

		it("filters by hasAttribution", async () => {
			const candidate = await db().attributionCandidate.create({
				data: {
					meme: {
						create: {
							source: "upload",
							contentType: "image/png",
							size: 100,
							sha256: "cand1",
						},
					},
					platform: "instagram",
					evidence: "url",
					confidence: 0.9,
					rank: 1,
				},
			});
			const attributedMeme = await createMeme({
				attributionId: candidate.id,
			});
			const nonAttributed = await createMeme({});

			const withAttr = await listMemes({
				hasAttribution: true,
				limit: 60,
				sort: "newest",
			});
			expect(withAttr.items.map((i) => i.id)).toEqual([attributedMeme.id]);

			const withoutAttr = await listMemes({
				hasAttribution: false,
				limit: 60,
				sort: "newest",
			});
			expect(withoutAttr.items.map((i) => i.id)).toContain(nonAttributed.id);
			expect(withoutAttr.items.map((i) => i.id)).not.toContain(
				attributedMeme.id,
			);
		});

		it("filters by duplicates", async () => {
			const original = await createMeme({});
			const dup = await createMeme({ duplicateOfId: original.id });

			const dupsOnly = await listMemes({
				duplicates: true,
				limit: 60,
				sort: "newest",
			});
			expect(dupsOnly.items.map((i) => i.id)).toEqual([dup.id]);
		});

		it("full-text searches q against the real generated tsvector column", async () => {
			const m1 = await createMeme({
				template: "distracted boyfriend",
				description: "a man looking at another woman",
			});
			const m2 = await createMeme({
				ocrText: "nobody expects the spanish inquisition",
			});
			const _m3 = await createMeme({
				description: "unrelated content here",
			});

			const boyfriend = await listMemes({
				q: "boyfriend",
				sort: "relevance",
				limit: 60,
			});
			expect(boyfriend.items).toHaveLength(1);
			expect(boyfriend.items[0]?.id).toBe(m1.id);

			const inquisition = await listMemes({
				q: "spanish inquisition",
				sort: "relevance",
				limit: 60,
			});
			expect(inquisition.items).toHaveLength(1);
			expect(inquisition.items[0]?.id).toBe(m2.id);

			const noMatch = await listMemes({
				q: "quantum physics",
				sort: "relevance",
				limit: 60,
			});
			expect(noMatch.items).toHaveLength(0);
		});

		it("search matches stemmed description words and unstemmed template/OCR words", async () => {
			const m1 = await createMeme({
				template: "doge",
				description: "two cats sitting on a mat",
			});
			const m2 = await createMeme({ ocrText: "cats rule everything" });
			const _m3 = await createMeme({ description: "a dog barking" });

			// "cats" is stored as the lexeme "cat" in the english-stemmed description
			// but as "cats" in the simple-parsed OCR text: both must be found.
			const res = await listMemes({ q: "cats", sort: "relevance", limit: 60 });
			expect(res.items.map((i) => i.id).sort()).toEqual([m1.id, m2.id].sort());
			const sit = await listMemes({ q: "sits", sort: "newest", limit: 60 });
			expect(sit.items.map((i) => i.id)).toEqual([m1.id]);
		});

		it("search treats hostile and malformed input as plain text", async () => {
			const m1 = await createMeme({ description: "harmless" });
			const inputs = [
				"'; DROP TABLE memes; --",
				'"unterminated',
				"((((",
				"- - -",
				"a & | ! b",
				"\\",
				"%00",
			];
			for (const q of inputs) {
				const res = await listMemes({ q, sort: "relevance", limit: 60 });
				expect(res.items).toEqual([]);
			}
			// the table is still there and untouched
			expect(await db().meme.count({ where: { id: m1.id } })).toBe(1);
		});

		it("relevance pagination walks every match exactly once", async () => {
			const ids: string[] = [];
			for (let i = 0; i < 7; i++) {
				ids.push((await createMeme({ template: `banana ${i}` })).id);
			}
			const seen: string[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < 5; page++) {
				const res = await listMemes({
					q: "banana",
					sort: "relevance",
					limit: 3,
					cursor,
				});
				seen.push(...res.items.map((i) => i.id));
				if (!res.nextCursor) break;
				cursor = res.nextCursor;
			}
			expect(seen.sort()).toEqual([...ids].sort());
		});

		it("every sort pages through nulls and ties without repeating or skipping", async () => {
			const rows = [
				{ postability: 90, rating: 5 },
				{ postability: 90, rating: null },
				{ postability: null, rating: 3 },
				{ postability: 10, rating: 3 },
				{ postability: null, rating: null },
				{ postability: 50, rating: 1 },
			];
			const ids: string[] = [];
			for (const r of rows) ids.push((await createMeme(r)).id);
			for (const sort of [
				"newest",
				"oldest",
				"postability",
				"takenAt",
				"rating",
			] as const) {
				const seen: string[] = [];
				let cursor: string | undefined;
				for (let page = 0; page < 10; page++) {
					const res = await listMemes({ sort, limit: 2, cursor });
					seen.push(...res.items.map((i) => i.id));
					if (!res.nextCursor) break;
					cursor = res.nextCursor;
				}
				expect(seen.length, sort).toBe(ids.length);
				expect(new Set(seen).size, sort).toBe(ids.length);
			}
		});

		it("sensitive=false also keeps memes whose flags are partly missing", async () => {
			const partial = await createMeme({ sensitivity: { nsfw: false } });
			const flagged = await createMeme({ sensitivity: { politics: true } });
			const res = await listMemes({
				sensitive: false,
				limit: 60,
				sort: "newest",
			});
			const ids = res.items.map((i) => i.id);
			expect(ids).toContain(partial.id);
			expect(ids).not.toContain(flagged.id);
		});

		it("cursor pagination is stable under ties", async () => {
			const fixedDate = new Date("2026-11-14T10:00:00.000Z");
			const memes = [];
			for (let i = 0; i < 7; i++) {
				memes.push(
					await createMeme({
						createdAt: fixedDate,
						postability: 50,
					}),
				);
			}

			// Paginate with limit 3
			const page1 = await listMemes({ limit: 3, sort: "newest" });
			expect(page1.items).toHaveLength(3);
			expect(page1.nextCursor).toBeTypeOf("string");
			const cursor1 = page1.nextCursor ?? "";

			const page2 = await listMemes({
				limit: 3,
				sort: "newest",
				cursor: cursor1,
			});
			expect(page2.items).toHaveLength(3);
			expect(page2.nextCursor).toBeTypeOf("string");
			const cursor2 = page2.nextCursor ?? "";

			const page3 = await listMemes({
				limit: 3,
				sort: "newest",
				cursor: cursor2,
			});
			expect(page3.items).toHaveLength(1);
			expect(page3.nextCursor).toBeNull();

			const retrievedIds = [
				...page1.items.map((i) => i.id),
				...page2.items.map((i) => i.id),
				...page3.items.map((i) => i.id),
			];
			expect(new Set(retrievedIds).size).toBe(7);
		});
	});

	describe("getMemeDetail", () => {
		it("throws 404 when meme is missing", async () => {
			await expect(
				getMemeDetail("00000000-0000-0000-0000-000000000099"),
			).rejects.toMatchObject({ status: 404 });
		});

		it("returns detail with all relations", async () => {
			const meme = await createMeme({
				approvedById: adminViewer.id,
				approvedAt: new Date("2026-11-14T11:00:00Z"),
			});
			const detail = await getMemeDetail(meme.id);
			expect(detail.id).toBe(meme.id);
			expect(detail.approvedBy).toEqual({
				id: adminViewer.id,
				email: adminViewer.email,
				username: adminViewer.username,
			});
			expect(detail.approvedAt).toBe("2026-11-14T11:00:00.000Z");
		});
	});

	describe("patchMeme", () => {
		it("changing AI fields adds them to userEdited", async () => {
			const meme = await createMeme({
				description: "original desc",
				template: "original temp",
				userEdited: [],
			});

			const updated = await patchMeme(
				meme.id,
				{ description: "new desc", rating: 5 },
				testViewer,
			);
			expect(updated.description).toBe("new desc");
			expect(updated.rating).toBe(5);
			expect(updated.userEdited).toContain("description");
			expect(updated.userEdited).not.toContain("rating");
		});

		it("replaces user tags and leaves AI tags alone", async () => {
			const meme = await createMeme({});
			const aiTag = await db().tag.create({
				data: { name: "ai-humor", kind: "topic" },
			});
			const oldUserTag = await db().tag.create({
				data: { name: "old-tag", kind: "user" },
			});
			await db().memeTag.createMany({
				data: [
					{ memeId: meme.id, tagId: aiTag.id, source: "ai" },
					{ memeId: meme.id, tagId: oldUserTag.id, source: "user" },
				],
			});

			const updated = await patchMeme(
				meme.id,
				{ tags: ["new-tag", "favorite"] },
				testViewer,
			);

			const tagNames = updated.tags.map((t) => t.name);
			expect(tagNames).toContain("ai-humor");
			expect(tagNames).toContain("new-tag");
			expect(tagNames).toContain("favorite");
			expect(tagNames).not.toContain("old-tag");

			const aiTagInResult = updated.tags.find((t) => t.name === "ai-humor");
			expect(aiTagInResult?.source).toBe("ai");
			const userTagInResult = updated.tags.find((t) => t.name === "new-tag");
			expect(userTagInResult?.source).toBe("user");
		});

		it("status: approved sets approvedById and approvedAt and audits", async () => {
			const meme = await createMeme({ status: "inbox" });
			const updated = await patchMeme(
				meme.id,
				{ status: "approved" },
				testViewer,
			);

			expect(updated.status).toBe("approved");
			expect(updated.approvedBy?.id).toBe(testViewer.id);
			expect(updated.approvedAt).not.toBeNull();

			const auditLog = await db().auditEvent.findFirst({
				where: { subjectId: meme.id, action: "meme.approve" },
			});
			expect(auditLog).not.toBeNull();
			expect(auditLog?.actorId).toBe(testViewer.id);
		});

		it("saving an unchanged AI field does not mark it user-edited", async () => {
			const meme = await createMeme({
				description: "same",
				hashtags: ["a", "b"],
				template: null,
			});
			const updated = await patchMeme(
				meme.id,
				{ description: "same", hashtags: ["a", "b"], template: null },
				testViewer,
			);
			expect(updated.userEdited).toEqual([]);

			const changed = await patchMeme(
				meme.id,
				{ hashtags: ["a", "c"] },
				testViewer,
			);
			expect(changed.userEdited).toEqual(["hashtags"]);
		});

		it("approving an already-approved meme keeps the original approver", async () => {
			const approvedAt = new Date("2026-01-01T00:00:00Z");
			const meme = await createMeme({
				status: "approved",
				approvedById: adminViewer.id,
				approvedAt,
			});
			const updated = await patchMeme(
				meme.id,
				{ status: "approved" },
				testViewer,
			);
			expect(updated.approvedBy?.id).toBe(adminViewer.id);
			expect(updated.approvedAt).toBe(approvedAt.toISOString());
			expect(
				await db().auditEvent.count({ where: { action: "meme.approve" } }),
			).toBe(0);
		});

		it("answers 404 (not 500) for a malformed id", async () => {
			await expect(getMemeDetail("not-a-uuid")).rejects.toMatchObject({
				status: 404,
			});
			await expect(
				patchMeme("not-a-uuid", { rating: 1 }, testViewer),
			).rejects.toMatchObject({ status: 404 });
		});

		it("rejects self-duplicate with 422", async () => {
			const meme = await createMeme({});
			await expect(
				patchMeme(meme.id, { duplicateOfId: meme.id }, testViewer),
			).rejects.toMatchObject({ status: 422 });
		});

		it("refuses 409 when rejecting/archiving a meme in a queued or draft post", async () => {
			const meme = await createMeme({ status: "inbox" });
			await createPost([meme.id], { status: "queued" });

			await expect(
				patchMeme(meme.id, { status: "rejected" }, testViewer),
			).rejects.toMatchObject({ status: 409 });

			await expect(
				patchMeme(meme.id, { status: "archived" }, testViewer),
			).rejects.toMatchObject({ status: 409 });
		});
	});

	describe("bulkMemes", () => {
		it("bulk approves memes and writes audit events", async () => {
			const m1 = await createMeme({ status: "inbox" });
			const m2 = await createMeme({ status: "inbox" });

			const res = await bulkMemes(
				{ ids: [m1.id, m2.id], action: "approve" },
				testViewer,
			);
			expect(res.updated).toBe(2);

			const updated1 = await db().meme.findUnique({ where: { id: m1.id } });
			expect(updated1?.status).toBe("approved");
			expect(updated1?.approvedById).toBe(testViewer.id);

			const audits = await db().auditEvent.findMany({
				where: { action: "meme.approve", subjectId: { in: [m1.id, m2.id] } },
			});
			expect(audits).toHaveLength(2);
		});

		it("bulk tags memes without duplicating existing tags", async () => {
			const m1 = await createMeme({});
			const m2 = await createMeme({});

			const res = await bulkMemes(
				{ ids: [m1.id, m2.id], action: "tag", tag: "funny" },
				testViewer,
			);
			expect(res.updated).toBe(2);

			// Calling tag again skips already tagged
			const res2 = await bulkMemes(
				{ ids: [m1.id, m2.id], action: "tag", tag: "funny" },
				testViewer,
			);
			expect(res2.updated).toBe(0);

			// Untag
			const resUntag = await bulkMemes(
				{ ids: [m1.id, m2.id], action: "untag", tag: "funny" },
				testViewer,
			);
			expect(resUntag.updated).toBe(2);
		});

		it("bulk reject refuses 409 if any meme is in a draft or queued post", async () => {
			const m1 = await createMeme({ status: "inbox" });
			const m2 = await createMeme({ status: "inbox" });
			await createPost([m2.id], { status: "draft" });

			await expect(
				bulkMemes({ ids: [m1.id, m2.id], action: "reject" }, testViewer),
			).rejects.toMatchObject({ status: 409 });

			// Verify transactionality: m1 was not changed to rejected
			const m1Check = await db().meme.findUnique({ where: { id: m1.id } });
			expect(m1Check?.status).toBe("inbox");
		});

		it("bulk analyze skips memes with analysis already queued or running", async () => {
			process.env.OPENROUTER_API_KEY = "sk-or-test";
			resetEnvCache();
			const m1 = await createMeme({});
			const m2 = await createMeme({});
			await db().analysis.create({
				data: {
					memeId: m1.id,
					kind: "meme",
					status: "running",
				},
			});

			const res = await bulkMemes(
				{ ids: [m1.id, m2.id], action: "analyze" },
				testViewer,
			);
			// Only m2 is eligible
			expect(res.updated).toBe(1);
			// ...and gets a queued Analysis row the UI can show
			const rows = await db().analysis.findMany({
				where: { memeId: m2.id, kind: "meme" },
			});
			expect(rows).toHaveLength(1);
			expect(rows[0]?.status).toBe("queued");
			delete process.env.OPENROUTER_API_KEY;
			resetEnvCache();
		});

		it("bulk analyze answers 503 when AI is not configured", async () => {
			delete process.env.OPENROUTER_API_KEY;
			resetEnvCache();
			const m1 = await createMeme({});
			await expect(
				bulkMemes({ ids: [m1.id], action: "analyze" }, testViewer),
			).rejects.toMatchObject({ status: 503 });
		});

		it("bulk actions ignore unknown ids instead of failing or auditing them", async () => {
			const m1 = await createMeme({ status: "inbox" });
			const ghost = "00000000-0000-0000-0000-00000000dead";

			const tagged = await bulkMemes(
				{ ids: [m1.id, ghost], action: "tag", tag: "x" },
				testViewer,
			);
			expect(tagged.updated).toBe(1);

			const approved = await bulkMemes(
				{ ids: [m1.id, ghost], action: "approve" },
				testViewer,
			);
			expect(approved.updated).toBe(1);
			const audits = await db().auditEvent.findMany({
				where: { action: "meme.approve" },
			});
			expect(audits.map((a) => a.subjectId)).toEqual([m1.id]);
		});

		it("bulk approve leaves already-approved memes (and their approver) alone", async () => {
			const approvedAt = new Date("2026-01-01T00:00:00Z");
			const done = await createMeme({
				status: "approved",
				approvedById: adminViewer.id,
				approvedAt,
			});
			const fresh = await createMeme({ status: "inbox" });

			const res = await bulkMemes(
				{ ids: [done.id, fresh.id], action: "approve" },
				testViewer,
			);
			expect(res.updated).toBe(1);
			const after = await db().meme.findUnique({ where: { id: done.id } });
			expect(after?.approvedById).toBe(adminViewer.id);
			expect(after?.approvedAt).toEqual(approvedAt);
			expect(
				await db().auditEvent.count({ where: { action: "meme.approve" } }),
			).toBe(1);
		});
	});

	describe("deleteMeme", () => {
		it("refuses 403 for non-admin user", async () => {
			const meme = await createMeme({});
			await expect(deleteMeme(meme.id, testViewer)).rejects.toMatchObject({
				status: 403,
			});
		});

		it("refuses 409 when meme is in a published or queued post", async () => {
			const meme = await createMeme({});
			await createPost([meme.id], { status: "published" });

			await expect(deleteMeme(meme.id, adminViewer)).rejects.toMatchObject({
				status: 409,
			});
		});

		it("refuses 409 for a publishing post and leaves the S3 objects alone", async () => {
			const fakeS3 = installFakeS3();
			try {
				const meme = await createMeme({ contentType: "image/png" });
				fakeS3.upload(
					`media/${meme.id}/thumb.webp`,
					new Uint8Array([1]),
					"image/webp",
				);
				await createPost([meme.id], { status: "publishing" });
				await expect(deleteMeme(meme.id, adminViewer)).rejects.toMatchObject({
					status: 409,
				});
				expect(fakeS3.objects.get(`media/${meme.id}/thumb.webp`)).toBeDefined();
				expect(await db().meme.count({ where: { id: meme.id } })).toBe(1);
			} finally {
				fakeS3.restore();
			}
		});

		it("cancels a draft left empty, renumbers others and removes ig renditions", async () => {
			const fakeS3 = installFakeS3();
			try {
				const a = await createMeme({});
				const b = await createMeme({});
				const c = await createMeme({});
				const solo = await createPost([a.id], { status: "draft" });
				const failed = await createPost([a.id, b.id, c.id], {
					status: "failed",
				});
				for (const p of [solo, failed]) {
					for (let i = 0; i < p.items.length; i++) {
						fakeS3.upload(`ig/${p.id}/${i}.jpg`, new Uint8Array([1]));
					}
				}

				await deleteMeme(a.id, adminViewer);

				const soloAfter = await db().post.findUniqueOrThrow({
					where: { id: solo.id },
					include: { items: true },
				});
				expect(soloAfter.items).toHaveLength(0);
				expect(soloAfter.status).toBe("cancelled");

				const failedAfter = await db().post.findUniqueOrThrow({
					where: { id: failed.id },
					include: { items: { orderBy: { position: "asc" } } },
				});
				expect(failedAfter.status).toBe("failed");
				expect(failedAfter.kind).toBe("carousel");
				expect(failedAfter.items.map((i) => [i.memeId, i.position])).toEqual([
					[b.id, 0],
					[c.id, 1],
				]);
				expect(
					[...fakeS3.objects.keys()].filter((k) => k.startsWith("ig/")),
				).toEqual([]);

				// Down to a single item: kind becomes image.
				await deleteMeme(b.id, adminViewer);
				const single = await db().post.findUniqueOrThrow({
					where: { id: failed.id },
				});
				expect(single.kind).toBe("image");
			} finally {
				fakeS3.restore();
			}
		});

		it("deletes S3 objects and row and writes audit event", async () => {
			const fakeS3 = installFakeS3();
			try {
				const meme = await createMeme({ contentType: "image/png" });
				fakeS3.upload(
					`media/${meme.id}/original.png`,
					new Uint8Array([1, 2, 3]),
					"image/png",
				);
				fakeS3.upload(
					`media/${meme.id}/display.webp`,
					new Uint8Array([4, 5, 6]),
					"image/webp",
				);
				fakeS3.upload(
					`media/${meme.id}/thumb.webp`,
					new Uint8Array([7, 8, 9]),
					"image/webp",
				);

				await deleteMeme(meme.id, adminViewer);

				// S3 objects are gone
				expect(
					fakeS3.objects.get(`media/${meme.id}/original.png`),
				).toBeUndefined();
				expect(
					fakeS3.objects.get(`media/${meme.id}/display.webp`),
				).toBeUndefined();
				expect(
					fakeS3.objects.get(`media/${meme.id}/thumb.webp`),
				).toBeUndefined();

				// Row is gone
				const check = await db().meme.findUnique({ where: { id: meme.id } });
				expect(check).toBeNull();

				// Audit event recorded
				const auditEntry = await db().auditEvent.findFirst({
					where: { action: "meme.delete", subjectId: meme.id },
				});
				expect(auditEntry).not.toBeNull();
				expect(auditEntry?.actorId).toBe(adminViewer.id);
			} finally {
				fakeS3.restore();
			}
		});
	});
});
