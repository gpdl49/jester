import { beforeEach, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/auth";
import { db } from "@/lib/db";
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
