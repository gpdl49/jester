import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { runDelete } from "@/lib/immich/delete";
import { PermanentJobError } from "@/lib/jobs/define";
import { memeKey } from "@/lib/s3";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { createImmichAsset, createMeme } from "@/test/helpers/factories";
import { type FakeImmich, installFakeImmich } from "@/test/helpers/immich";
import { type FakeS3, installFakeS3 } from "@/test/helpers/s3";

describeWithDb("runDelete", () => {
	let fakeImmich: FakeImmich;
	let fakeS3: FakeS3;

	const originalDeleteEnv = process.env.IMMICH_DELETE_ENABLED;
	const originalApiKey = process.env.IMMICH_API_KEY;

	beforeEach(async () => {
		await resetDb();
		fakeImmich = installFakeImmich();
		fakeS3 = installFakeS3();
		process.env.IMMICH_API_KEY = "test-key";
		process.env.IMMICH_DELETE_ENABLED = "true";
		resetEnvCache();
	});

	afterEach(async () => {
		fakeImmich.restore();
		fakeS3.restore();
		process.env.IMMICH_DELETE_ENABLED = originalDeleteEnv;
		process.env.IMMICH_API_KEY = originalApiKey;
		resetEnvCache();
		await resetDb();
	});

	async function setupMemeAndAsset() {
		const content = new TextEncoder().encode("meme-image-bytes");
		const hexSha256 = createHash("sha256").update(content).digest("hex");
		const base64Sha256 = createHash("sha256").update(content).digest("base64");

		const meme = await createMeme({
			size: content.byteLength,
			contentType: "image/png",
			sha256: hexSha256,
		});

		const asset = await createImmichAsset({
			memeId: meme.id,
			triageStatus: "imported",
		});

		const key = memeKey(meme.id, "original", meme.contentType);
		fakeS3.upload(key, content, "image/png");
		const stored = fakeS3.objects.get(key);
		if (stored) {
			stored.sha256 = base64Sha256;
		}

		return { meme, asset, content, key, hexSha256, base64Sha256 };
	}

	it("permanently deletes asset when S3 verification passes and kill switch is on", async () => {
		const { asset, meme, base64Sha256 } = await setupMemeAndAsset();

		await runDelete(asset.id);

		// Verify Immich deleteAssets was called with force: true
		expect(fakeImmich.deleted).toEqual([
			{ ids: [asset.immichId], force: true },
		]);

		// Verify asset triageStatus is deleted
		const updatedAsset = await db().immichAsset.findUnique({
			where: { id: asset.id },
		});
		expect(updatedAsset?.triageStatus).toBe("deleted");

		// Verify ImmichDeletion record was created with status done
		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("done");
		expect(deletions[0]?.verifiedSha256).toBe(base64Sha256);
		expect(deletions[0]?.memeId).toBe(meme.id);

		// Verify AuditEvent was created
		const auditEvents = await db().auditEvent.findMany({
			where: { action: "immich.delete", subjectId: asset.id },
		});
		expect(auditEvents).toHaveLength(1);
		expect(auditEvents[0]?.subjectType).toBe("immich_asset");
		expect(auditEvents[0]?.data).toMatchObject({ status: "done" });
	});

	it("refuses deletion when original S3 object is missing", async () => {
		const { asset, key } = await setupMemeAndAsset();
		fakeS3.objects.delete(key);

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);

		expect(fakeImmich.deleted).toHaveLength(0);

		const updatedAsset = await db().immichAsset.findUnique({
			where: { id: asset.id },
		});
		expect(updatedAsset?.triageStatus).toBe("imported");

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("failed");
		expect(deletions[0]?.error).toContain("missing");

		const events = await db().auditEvent.findMany({
			where: { action: "immich.delete", subjectId: asset.id },
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toMatchObject({
			status: "failed",
			immichId: asset.immichId,
		});
	});

	it("audits a failed deletion for an asset with no meme", async () => {
		const asset = await createImmichAsset({ triageStatus: "imported" });

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);

		const events = await db().auditEvent.findMany({
			where: { action: "immich.delete", subjectId: asset.id },
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toMatchObject({ status: "failed" });
	});

	it("refuses deletion when S3 object size does not match meme size", async () => {
		const { asset, key, base64Sha256 } = await setupMemeAndAsset();
		// Modify stored S3 object to have different length
		const stored = fakeS3.objects.get(key);
		if (!stored) throw new Error("S3 object not found in test setup");
		stored.body = new TextEncoder().encode("different size content!");
		stored.sha256 = base64Sha256;

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);
		expect(fakeImmich.deleted).toHaveLength(0);

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("failed");
		expect(deletions[0]?.error).toContain("size mismatch");
	});

	it("refuses deletion when S3 object sha256 checksum does not match", async () => {
		const { asset, key } = await setupMemeAndAsset();
		const stored = fakeS3.objects.get(key);
		if (!stored) throw new Error("S3 object not found in test setup");
		stored.sha256 = "differentBase64Sha256=";

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);
		expect(fakeImmich.deleted).toHaveLength(0);

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("failed");
		expect(deletions[0]?.error).toContain("checksum mismatch");
	});

	it("records skipped and does not delete when kill switch is off", async () => {
		const { asset } = await setupMemeAndAsset();
		process.env.IMMICH_DELETE_ENABLED = "false";
		resetEnvCache();

		await runDelete(asset.id);

		expect(fakeImmich.deleted).toHaveLength(0);

		const updatedAsset = await db().immichAsset.findUnique({
			where: { id: asset.id },
		});
		expect(updatedAsset?.triageStatus).toBe("imported");

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("skipped");

		const events = await db().auditEvent.findMany({
			where: { action: "immich.delete", subjectId: asset.id },
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toMatchObject({ status: "skipped" });
	});

	it("records skipped and does not delete when immich.deletePaused setting is true", async () => {
		const { asset } = await setupMemeAndAsset();
		await db().setting.upsert({
			where: { key: "immich.deletePaused" },
			create: { key: "immich.deletePaused", value: true },
			update: { value: true },
		});

		await runDelete(asset.id);

		expect(fakeImmich.deleted).toHaveLength(0);

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("skipped");
	});

	it("is idempotent: no-op if asset is already marked deleted", async () => {
		const { asset } = await setupMemeAndAsset();
		await db().immichAsset.update({
			where: { id: asset.id },
			data: { triageStatus: "deleted" },
		});

		await runDelete(asset.id);

		expect(fakeImmich.deleted).toHaveLength(0);
		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(0);
	});

	it("fails permanently if asset has no associated meme", async () => {
		const asset = await createImmichAsset({
			memeId: null,
			triageStatus: "imported",
		});

		await expect(runDelete(asset.id)).rejects.toThrow(PermanentJobError);

		const deletions = await db().immichDeletion.findMany({
			where: { immichAssetId: asset.id },
		});
		expect(deletions).toHaveLength(1);
		expect(deletions[0]?.status).toBe("failed");
	});
});
