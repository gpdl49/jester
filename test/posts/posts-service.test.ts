import { beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";
import {
	createPost,
	getPost,
	patchPost,
	publishNow,
	reorderPosts,
} from "@/lib/posts/service";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createMeme } from "@/test/helpers/factories";
import { userId } from "@/test/helpers/users";

describeWithDb("posts service", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("creates a single-image post defaulting caption to the first meme's captionDraft", async () => {
		const authorId = await userId();
		const meme = await createMeme({
			status: "approved",
			captionDraft: "Draft caption from AI",
			creditText: "photographer",
			hashtags: ["funny"],
		});

		const post = await createPost({ memeIds: [meme.id] }, authorId);

		expect(post.kind).toBe("image");
		expect(post.status).toBe("draft");
		expect(post.caption).toBe("Draft caption from AI");
		expect(post.itemCount).toBe(1);
		expect(post.items[0]?.meme.id).toBe(meme.id);
		expect(post.renderedCaption).toContain("Draft caption from AI");
		expect(post.renderedCaption).toContain("📸 photographer");
		expect(post.createdBy?.id).toBe(authorId);
	});

	it("creates a carousel post for 2–10 memes with explicit caption", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });
		const m3 = await createMeme({ status: "approved" });

		const post = await createPost({
			memeIds: [m1.id, m2.id, m3.id],
			caption: "My custom carousel caption",
		});

		expect(post.kind).toBe("carousel");
		expect(post.caption).toBe("My custom carousel caption");
		expect(post.itemCount).toBe(3);
		expect(post.items.map((i) => i.meme.id)).toEqual([m1.id, m2.id, m3.id]);
	});

	it("rejects non-approved memes with 422 unprocessable", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "inbox" }); // not approved

		await expect(createPost({ memeIds: [m1.id, m2.id] })).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ApiError &&
				err.status === 422 &&
				err.message.includes("approved"),
		);
	});

	it("rejects post with 0 memes or more than 10 memes with 422", async () => {
		await expect(createPost({ memeIds: [] })).rejects.toSatisfy(
			(err: unknown) => err instanceof ApiError && err.status === 422,
		);

		const elevenMemes = await Promise.all(
			Array.from({ length: 11 }, () => createMeme({ status: "approved" })),
		);
		await expect(
			createPost({ memeIds: elevenMemes.map((m) => m.id) }),
		).rejects.toSatisfy(
			(err: unknown) => err instanceof ApiError && err.status === 422,
		);
	});

	it("enforces serializable conflict: a meme in another non-cancelled post throws 409", async () => {
		const meme = await createMeme({ status: "approved" });

		// First post takes the meme
		await createPost({ memeIds: [meme.id] });

		// Second post trying to use the same meme must conflict
		await expect(createPost({ memeIds: [meme.id] })).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ApiError &&
				err.status === 409 &&
				err.message.includes("already in another active post"),
		);
	});

	it("cancelling a post frees its memes for use in new posts", async () => {
		const meme = await createMeme({ status: "approved" });

		const postA = await createPost({ memeIds: [meme.id] });
		expect(postA.status).toBe("draft");

		// Cancel post A
		await patchPost(postA.id, { status: "cancelled" });

		// Now post B can claim the meme without conflict
		const postB = await createPost({ memeIds: [meme.id] });
		expect(postB.status).toBe("draft");
		expect(postB.items[0]?.meme.id).toBe(meme.id);
	});

	it("patches post caption, replaces meme items in order, and updates alt texts", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });
		const m3 = await createMeme({ status: "approved" });

		const post = await createPost({ memeIds: [m1.id, m2.id] });
		expect(post.itemCount).toBe(2);

		const updated = await patchPost(post.id, {
			caption: "Updated caption",
			memeIds: [m3.id, m1.id], // new order and new meme
			altTexts: ["Alt for m3", "Alt for m1"],
		});

		expect(updated.caption).toBe("Updated caption");
		expect(updated.itemCount).toBe(2);
		expect(updated.items[0]?.meme.id).toBe(m3.id);
		expect(updated.items[0]?.altText).toBe("Alt for m3");
		expect(updated.items[1]?.meme.id).toBe(m1.id);
		expect(updated.items[1]?.altText).toBe("Alt for m1");
	});

	it("refuses PATCH with 409 once publishing or published", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost({ memeIds: [meme.id] });

		// Set status directly to publishing
		await db().post.update({
			where: { id: post.id },
			data: { status: "publishing" },
		});

		await expect(
			patchPost(post.id, { caption: "Should fail" }),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ApiError &&
				err.status === 409 &&
				err.message.includes("publishing or published"),
		);
	});

	it("publish-now transitions draft or queued to queued at now and enqueues publish job", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost({ memeIds: [meme.id], status: "draft" });

		const result = await publishNow(post.id);

		expect(result.status).toBe("queued");
		expect(result.scheduledAt).not.toBeNull();

		// Check audit log
		const auditLog = await db().auditEvent.findFirst({
			where: { action: "post.publish-now", subjectId: post.id },
		});
		expect(auditLog).not.toBeNull();

		// Calling publish-now again when already queued is allowed
		const result2 = await publishNow(post.id);
		expect(result2.status).toBe("queued");
	});

	it("reorders queuePosition for unscheduled queued posts", async () => {
		const m1 = await createMeme({ status: "approved" });
		const m2 = await createMeme({ status: "approved" });
		const m3 = await createMeme({ status: "approved" });

		const p1 = await createPost({ memeIds: [m1.id], status: "queued" });
		const p2 = await createPost({ memeIds: [m2.id], status: "queued" });
		const p3 = await createPost({ memeIds: [m3.id], status: "queued" });

		// Reverse order: p3, p2, p1
		await reorderPosts([p3.id, p2.id, p1.id]);

		const reloadedP3 = await getPost(p3.id);
		const reloadedP2 = await getPost(p2.id);
		const reloadedP1 = await getPost(p1.id);

		expect(reloadedP3.queuePosition).toBe(1);
		expect(reloadedP2.queuePosition).toBe(2);
		expect(reloadedP1.queuePosition).toBe(3);
	});

	it("only one of many concurrent creates wins a meme; the rest get 409, never 500", async () => {
		const meme = await createMeme({ status: "approved" });
		const results = await Promise.allSettled(
			Array.from({ length: 6 }, () => createPost({ memeIds: [meme.id] })),
		);
		const ok = results.filter((r) => r.status === "fulfilled");
		const failed = results.filter((r) => r.status === "rejected");
		expect(ok).toHaveLength(1);
		for (const f of failed) {
			expect(f.reason).toBeInstanceOf(ApiError);
			expect((f.reason as ApiError).status).toBe(409);
		}
		expect(await db().postItem.count({ where: { memeId: meme.id } })).toBe(1);
	});

	it("rejects an unknown accountId with 404 instead of a foreign-key 500", async () => {
		const meme = await createMeme({ status: "approved" });
		await expect(
			createPost({
				memeIds: [meme.id],
				accountId: "019d0000-0000-7000-8000-000000000000",
			}),
		).rejects.toSatisfy((e) => e instanceof ApiError && e.status === 404);
	});

	it("publish-now never moves a post that is already publishing back to queued", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost({ memeIds: [meme.id], status: "queued" });
		await db().post.update({
			where: { id: post.id },
			data: { status: "publishing" },
		});

		await expect(publishNow(post.id)).rejects.toSatisfy(
			(e) => e instanceof ApiError && e.status === 409,
		);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } })).status,
		).toBe("publishing");
	});

	it("editing the caption or memes drops containers made for the old content", async () => {
		const m1 = await createMeme({ status: "approved" });
		const post = await createPost({
			memeIds: [m1.id],
			status: "queued",
			caption: "old",
		});
		await db().post.update({
			where: { id: post.id },
			data: { containerIds: ["c1"], containerAt: new Date() },
		});

		await patchPost(post.id, { scheduledAt: null });
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: post.id } }))
				.containerIds,
		).toEqual(["c1"]);

		await patchPost(post.id, { caption: "new" });
		const row = await db().post.findUniqueOrThrow({ where: { id: post.id } });
		expect(row.containerIds).toEqual([]);
		expect(row.containerAt).toBeNull();
	});

	it("retrying a failed post gives it a fresh attempt budget and the next free slot", async () => {
		const meme = await createMeme({ status: "approved" });
		const post = await createPost({ memeIds: [meme.id], status: "queued" });
		await db().post.update({
			where: { id: post.id },
			data: {
				status: "failed",
				attempts: 3,
				error: "boom",
				scheduledAt: new Date(Date.now() - 3600_000),
			},
		});

		const result = await patchPost(post.id, { status: "queued" });

		expect(result.status).toBe("queued");
		expect(result.attempts).toBe(0);
		expect(result.error).toBeNull();
		expect(result.scheduledAt).toBeNull();
		expect(result.queuePosition).not.toBeNull();
	});

	it("reviving a cancelled post is refused while one of its memes is in another post", async () => {
		const meme = await createMeme({ status: "approved" });
		const a = await createPost({ memeIds: [meme.id] });
		await patchPost(a.id, { status: "cancelled" });
		await createPost({ memeIds: [meme.id] });

		await expect(patchPost(a.id, { status: "queued" })).rejects.toSatisfy(
			(e) => e instanceof ApiError && e.status === 409,
		);
		expect(
			(await db().post.findUniqueOrThrow({ where: { id: a.id } })).status,
		).toBe("cancelled");
	});

	it("reorder of a subset keeps queue positions unique", async () => {
		const memes = await Promise.all(
			[0, 1, 2].map(() => createMeme({ status: "approved" })),
		);
		const made = [];
		for (const [i, m] of memes.entries()) {
			const p = await createPost({ memeIds: [m.id], status: "queued" });
			await db().post.update({
				where: { id: p.id },
				data: { queuePosition: i + 1 },
			});
			made.push(p);
		}
		const [a, b, c] = made;
		if (!a || !b || !c) throw new Error("setup");

		await reorderPosts([c.id]);

		const rows = await db().post.findMany({
			where: { status: "queued" },
			orderBy: { queuePosition: "asc" },
		});
		expect(rows.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
		expect(new Set(rows.map((r) => r.queuePosition)).size).toBe(3);
	});
});
