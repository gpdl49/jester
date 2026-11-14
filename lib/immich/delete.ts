import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { immich } from "@/lib/immich/client";
import { PermanentJobError } from "@/lib/jobs/define";
import { headObject, memeKey } from "@/lib/s3";
import { getSetting } from "@/lib/settings";

/**
 * Permanently deletes an asset from Immich after verifying that its original
 * exists in S3 with the matching size and SHA-256 (docs/contract.md "immich.delete").
 */
export async function runDelete(immichAssetId: string): Promise<void> {
	const asset = await db().immichAsset.findUnique({
		where: { id: immichAssetId },
		include: { meme: true },
	});

	if (!asset) {
		throw new PermanentJobError(`ImmichAsset not found: ${immichAssetId}`);
	}

	// Idempotent: an asset already deleted is a no-op
	if (asset.triageStatus === "deleted") {
		return;
	}

	const meme = asset.meme;
	if (!meme) {
		const errorMsg = `No associated meme for asset ${immichAssetId}`;
		await db().immichDeletion.create({
			data: {
				immichAssetId: asset.id,
				immichId: asset.immichId,
				memeId: null,
				status: "failed",
				error: errorMsg,
			},
		});
		throw new PermanentJobError(errorMsg);
	}

	const key = memeKey(meme.id, "original", meme.contentType);
	const head = await headObject(key);
	const expectedSha256Base64 = Buffer.from(meme.sha256, "hex").toString(
		"base64",
	);

	const sizeMatches = head != null && head.size === meme.size;
	const shaMatches = head != null && head.sha256 === expectedSha256Base64;

	if (!head || !sizeMatches || !shaMatches) {
		let errorMsg = "S3 verification failed: ";
		if (!head) {
			errorMsg += "original object missing in S3";
		} else if (!sizeMatches) {
			errorMsg += `size mismatch (S3: ${head.size}, Meme: ${meme.size})`;
		} else {
			errorMsg += `checksum mismatch (S3: ${head.sha256}, expected: ${expectedSha256Base64})`;
		}

		await db().immichDeletion.create({
			data: {
				immichAssetId: asset.id,
				immichId: asset.immichId,
				memeId: meme.id,
				status: "failed",
				verifiedSha256: head?.sha256 ?? null,
				error: errorMsg,
			},
		});
		throw new PermanentJobError(errorMsg);
	}

	// Honor feature switch and pause setting
	const deletePaused = await getSetting("immich.deletePaused");
	if (!features().immichDelete || deletePaused) {
		await db().immichDeletion.create({
			data: {
				immichAssetId: asset.id,
				immichId: asset.immichId,
				memeId: meme.id,
				status: "skipped",
				verifiedSha256: head.sha256,
			},
		});
		return;
	}

	// Delete from Immich permanently; a 404 counts as done
	await immich().deleteAssets([asset.immichId], { force: true });

	await db().$transaction(async (tx) => {
		await tx.immichAsset.update({
			where: { id: asset.id },
			data: { triageStatus: "deleted" },
		});

		await tx.immichDeletion.create({
			data: {
				immichAssetId: asset.id,
				immichId: asset.immichId,
				memeId: meme.id,
				status: "done",
				verifiedSha256: head.sha256,
			},
		});

		await audit(
			{
				actorId: null,
				action: "immich.delete",
				subjectType: "immich_asset",
				subjectId: asset.id,
				data: {
					immichId: asset.immichId,
					memeId: meme.id,
					verifiedSha256: head.sha256,
				},
			},
			tx,
		);
	});
}
