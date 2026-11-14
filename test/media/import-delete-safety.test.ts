import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { runDelete } from "@/lib/immich/delete";
import { PermanentJobError } from "@/lib/jobs/define";
import { importFromImmich, importFromUpload } from "@/lib/media/import";
import { memeKey, uploadKey } from "@/lib/s3";
import { pngImage, twoTone } from "@/test/fixtures/images";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
import {
	type FakeImmich,
	fakeAsset,
	installFakeImmich,
} from "@/test/helpers/immich";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";
import { userId } from "@/test/helpers/users";

vi.mock("@/lib/jobs/queue", () => ({
	enqueue: vi.fn(async () => "job-id"),
}));

const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("base64");
const sha256Hex = (b: Uint8Array) =>
	createHash("sha256").update(b).digest("hex");

describeWithDb("Immich -> S3 -> permanent delete safety", () => {
	let fakeS3: FakeS3;
	let immichFake: FakeImmich;
	const prev = {
		key: process.env.IMMICH_API_KEY,
		del: process.env.IMMICH_DELETE_ENABLED,
	};

	beforeEach(async () => {
		await resetDb();
		fakeS3 = installFakeS3();
		immichFake = installFakeImmich();
		process.env.IMMICH_API_KEY = "k";
		process.env.IMMICH_DELETE_ENABLED = "true";
		resetEnvCache();
	});

	afterEach(async () => {
		fakeS3.restore();
		immichFake.restore();
		process.env.IMMICH_API_KEY = prev.key;
		process.env.IMMICH_DELETE_ENABLED = prev.del;
		resetEnvCache();
		await resetDb();
	});

	async function acceptedAsset(bytes: Uint8Array, mime = "image/png") {
		const asset = await createImmichAsset({
			triageStatus: "accepted",
			checksum: sha1(bytes),
			mimeType: mime,
		});
		immichFake.add(
			fakeAsset(
				{
					id: asset.immichId,
					checksum: sha1(bytes),
					originalMimeType: mime,
				},
				bytes,
			),
		);
		return asset;
	}

	/** Makes the next S3 PutObject fail once. */
	function failNextPut() {
		const orig = fakeS3.client.send.bind(fakeS3.client);
		let armed = true;
		// biome-ignore lint/suspicious/noExplicitAny: command dispatch
		fakeS3.client.send = (async (cmd: any) => {
			if (armed && cmd instanceof PutObjectCommand) {
				armed = false;
				throw new Error("S3 down");
			}
			return orig(cmd);
		}) as typeof fakeS3.client.send;
	}

	it("happy path: deletes only after the exact bytes are in S3", async () => {
		const bytes = await pngImage(60, 40);
		const asset = await acceptedAsset(bytes);
		const { memeId } = await importFromImmich(asset.id);

		const stored = fakeS3.objects.get(memeKey(memeId, "original", "image/png"));
		expect(Buffer.from(stored?.body ?? []).equals(bytes)).toBe(true);

		await runDelete(asset.id);
		expect(immichFake.deleted).toEqual([
			{ ids: [asset.immichId], force: true },
		]);
	});

	it("retry after a failed S3 write still uploads the bytes before any delete", async () => {
		const bytes = await pngImage(60, 40);
		const asset = await acceptedAsset(bytes);

		failNextPut();
		await expect(importFromImmich(asset.id)).rejects.toThrow("S3 down");
		// Nothing was deleted and the asset is still accepted.
		expect(immichFake.deleted).toHaveLength(0);
		expect(
			(await db().immichAsset.findUniqueOrThrow({ where: { id: asset.id } }))
				.triageStatus,
		).toBe("accepted");

		// The retry finds the orphaned meme row (same SHA-256) but must not trust it.
		const { memeId } = await importFromImmich(asset.id);
		const stored = fakeS3.objects.get(memeKey(memeId, "original", "image/png"));
		expect(Buffer.from(stored?.body ?? []).equals(bytes)).toBe(true);
		expect(stored?.sha256).toBe(
			createHash("sha256").update(bytes).digest("base64"),
		);

		await runDelete(asset.id);
		expect(immichFake.deleted).toHaveLength(1);
	});

	it("duplicate of a meme whose original is missing repairs S3 before linking", async () => {
		const bytes = await pngImage(70, 30);
		const existing = await createMeme({
			sha256: sha256Hex(bytes),
			size: bytes.byteLength,
		});
		const asset = await acceptedAsset(bytes);

		await importFromImmich(asset.id);
		const stored = fakeS3.objects.get(
			memeKey(existing.id, "original", "image/png"),
		);
		expect(Buffer.from(stored?.body ?? []).equals(bytes)).toBe(true);
		await runDelete(asset.id);
		expect(immichFake.deleted).toHaveLength(1);
	});

	it("duplicate of a meme that already has an asset is deleted via the pending link, and only if S3 matches", async () => {
		const bytes = await pngImage(70, 30);
		const first = await acceptedAsset(bytes);
		const { memeId } = await importFromImmich(first.id);
		await runDelete(first.id);

		// A second Immich asset with identical bytes.
		const second = await acceptedAsset(bytes);
		const again = await importFromImmich(second.id);
		expect(again.memeId).toBe(memeId);
		const row = await db().immichAsset.findUniqueOrThrow({
			where: { id: second.id },
		});
		expect(row.memeId).toBeNull();

		// Corrupt the stored original: delete must refuse.
		const key = memeKey(memeId, "original", "image/png");
		const good = fakeS3.objects.get(key);
		if (!good) throw new Error("setup");
		fakeS3.objects.set(key, { ...good, sha256: "AAAA" });
		await expect(runDelete(second.id)).rejects.toThrow(PermanentJobError);
		expect(immichFake.deleted).toHaveLength(1); // only the first asset

		// Restore: now it is deleted and the pending row becomes done.
		fakeS3.objects.set(key, good);
		await runDelete(second.id);
		expect(immichFake.deleted).toHaveLength(2);
		const done = await db().immichDeletion.findMany({
			where: { immichAssetId: second.id, status: "done" },
		});
		expect(done).toHaveLength(1);
		expect(done[0]?.memeId).toBe(memeId);
	});

	it("meme deleted from the library before immich.delete: nothing is deleted", async () => {
		const bytes = await pngImage(60, 40);
		const asset = await acceptedAsset(bytes);
		const { memeId } = await importFromImmich(asset.id);
		await db().meme.delete({ where: { id: memeId } });

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);
		expect(immichFake.deleted).toHaveLength(0);
		expect(immichFake.assets.has(asset.immichId)).toBe(true);
	});

	it("kill switch and paused setting keep the asset in Immich", async () => {
		const bytes = await pngImage(60, 40);
		const asset = await acceptedAsset(bytes);
		await importFromImmich(asset.id);

		process.env.IMMICH_DELETE_ENABLED = "false";
		resetEnvCache();
		await runDelete(asset.id);
		expect(immichFake.deleted).toHaveLength(0);

		process.env.IMMICH_DELETE_ENABLED = "true";
		resetEnvCache();
		await db().setting.upsert({
			where: { key: "immich.deletePaused" },
			create: { key: "immich.deletePaused", value: true },
			update: { value: true },
		});
		await runDelete(asset.id);
		expect(immichFake.deleted).toHaveLength(0);
		expect(
			await db().immichDeletion.count({
				where: { immichAssetId: asset.id, status: "skipped" },
			}),
		).toBe(2);
	});

	it("HEIC: renditions are made from Immich before the asset can be deleted", async () => {
		// A decodable JPEG standing in for Immich's fullsize rendition.
		const bytes = await (await twoTone(300, 200)).jpeg().toBuffer();
		const asset = await acceptedAsset(bytes, "image/heic");
		const { memeId } = await importFromImmich(asset.id);

		const meme = await db().meme.findUniqueOrThrow({ where: { id: memeId } });
		expect(meme.renditionsReady).toBe(true);
		expect(fakeS3.objects.has(memeKey(memeId, "original", "image/heic"))).toBe(
			true,
		);
		expect(fakeS3.objects.has(memeKey(memeId, "display"))).toBe(true);

		await runDelete(asset.id);
		expect(immichFake.deleted).toHaveLength(1);
	});

	it("checksum mismatch: error, no S3 object, no delete", async () => {
		const bytes = await pngImage(60, 40);
		const asset = await createImmichAsset({
			triageStatus: "accepted",
			checksum: sha1(new Uint8Array([1])),
		});
		immichFake.add(fakeAsset({ id: asset.immichId }, bytes));
		await expect(importFromImmich(asset.id)).rejects.toThrow(PermanentJobError);
		expect(fakeS3.objects.size).toBe(0);
		expect(immichFake.deleted).toHaveLength(0);
	});

	it("100 MiB cap: aborts, cancels the stream and leaves no temp file", async () => {
		const asset = await createImmichAsset({
			triageStatus: "accepted",
			checksum: "x",
		});
		let cancelled = false;
		let sent = 0;
		const chunk = new Uint8Array(1024 * 1024);
		immichFake.client.downloadOriginal = async () => ({
			contentType: "image/png",
			size: null,
			body: new ReadableStream<Uint8Array>({
				pull(c) {
					sent++;
					c.enqueue(chunk);
					if (sent > 200) c.close();
				},
				cancel() {
					cancelled = true;
				},
			}),
		});
		await expect(importFromImmich(asset.id)).rejects.toThrow("100 MiB");
		expect(cancelled).toBe(true);
		expect(sent).toBeLessThan(110);
		expect(
			fs.readdirSync(os.tmpdir()).filter((f) => f.includes(asset.id)),
		).toEqual([]);
		expect(fakeS3.objects.size).toBe(0);
	});

	it("upload: failed S3 write keeps the staging object and the retry repairs the original", async () => {
		const bytes = await pngImage(50, 50);
		const upload = await db().upload.create({
			data: {
				uploaderId: await userId(),
				contentType: "image/png",
				size: bytes.byteLength,
				status: "complete",
			},
		});
		fakeS3.upload(uploadKey(upload.id), bytes, "image/png");

		failNextPut();
		await expect(importFromUpload(upload.id)).rejects.toThrow("S3 down");
		expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(true);

		const { memeId } = await importFromUpload(upload.id);
		const stored = fakeS3.objects.get(memeKey(memeId, "original", "image/png"));
		expect(Buffer.from(stored?.body ?? []).equals(bytes)).toBe(true);
		expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);
	});

	it("upload: object replaced with a different size after completion is rejected", async () => {
		const bytes = await pngImage(50, 50);
		const upload = await db().upload.create({
			data: {
				uploaderId: await userId(),
				contentType: "image/png",
				size: bytes.byteLength,
				status: "complete",
			},
		});
		fakeS3.upload(
			uploadKey(upload.id),
			new Uint8Array(bytes.byteLength + 10),
			"image/png",
		);
		await expect(importFromUpload(upload.id)).rejects.toThrow(
			PermanentJobError,
		);
		expect(
			(await db().upload.findUniqueOrThrow({ where: { id: upload.id } }))
				.status,
		).toBe("failed");
		expect(fakeS3.objects.has(uploadKey(upload.id))).toBe(false);
	});
});
