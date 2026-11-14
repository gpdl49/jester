import { db } from "@/lib/db";
import { features } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import { immich } from "@/lib/immich/client";
import { scorePrefilter } from "@/lib/immich/prefilter";
import type { ImmichAssetDto, ImmichClient } from "@/lib/immich/types";
import { triageClassify } from "@/lib/jobs/definitions/triage-classify";
import { enqueue } from "@/lib/jobs/queue";
import { getSetting } from "@/lib/settings";

const BATCH_SIZE = 500;
const SMART_BATCH_SIZE = 250;

type ProcessOptions = {
	additionalSmartHit?: string;
};

async function processAsset(
	client: ImmichClient,
	dto: ImmichAssetDto,
	threshold: number,
	options: ProcessOptions = {},
): Promise<void> {
	// Only import images
	if (dto.type !== "IMAGE") {
		return;
	}

	const existing = await db().immichAsset.findUnique({
		where: { immichId: dto.id },
	});

	// Trashed assets that are not imported yet get triageStatus: error, error: "gone"
	if (dto.isTrashed) {
		if (
			existing &&
			(existing.triageStatus === "imported" ||
				existing.triageStatus === "deleted")
		) {
			// Already imported or deleted: keep status
			return;
		}

		if (existing) {
			await db().immichAsset.update({
				where: { id: existing.id },
				data: {
					triageStatus: "error",
					error: "gone",
				},
			});
		} else {
			await db().immichAsset.create({
				data: {
					immichId: dto.id,
					checksum: dto.checksum,
					originalFileName: dto.originalFileName,
					mimeType: dto.originalMimeType,
					width: dto.width ?? dto.exifInfo?.exifImageWidth ?? null,
					height: dto.height ?? dto.exifInfo?.exifImageHeight ?? null,
					fileCreatedAt: dto.fileCreatedAt ? new Date(dto.fileCreatedAt) : null,
					cameraMake: dto.exifInfo?.make ?? null,
					cameraModel: dto.exifInfo?.model ?? null,
					triageStatus: "error",
					error: "gone",
				},
			});
		}
		return;
	}

	// Calculate smart hits
	const smartHitsSet = new Set(existing?.smartHits ?? []);
	if (options.additionalSmartHit) {
		smartHitsSet.add(options.additionalSmartHit);
	}
	const smartHits = Array.from(smartHitsSet);

	// Fetch OCR text if not already cached, or refresh
	let ocrText: string | null = existing?.ocrText ?? null;
	try {
		const fetchedOcr = await client.getOcrText(dto.id);
		if (fetchedOcr != null) {
			ocrText = fetchedOcr;
		}
	} catch {
		// Non-critical, ignore OCR error
	}

	const { score, signals } = scorePrefilter(
		{
			originalFileName: dto.originalFileName,
			mimeType: dto.originalMimeType,
			width: dto.width ?? dto.exifInfo?.exifImageWidth,
			height: dto.height ?? dto.exifInfo?.exifImageHeight,
			cameraMake: dto.exifInfo?.make,
			cameraModel: dto.exifInfo?.model,
			ocrText,
			smartHits,
		},
		{ smartHits, ocrText },
	);

	let newStatus = existing ? existing.triageStatus : "unscored";
	let shouldEnqueue = false;

	if (!existing) {
		if (score >= threshold) {
			newStatus = "pending";
			shouldEnqueue = true;
		} else {
			newStatus = "unscored";
		}
	} else if (existing.triageStatus === "unscored") {
		if (score >= threshold) {
			newStatus = "pending";
			shouldEnqueue = true;
		}
	}
	// Never downgrade past pending (scored, accepted, rejected, imported, deleted, error remain untouched)

	const assetData: Prisma.ImmichAssetUncheckedCreateInput = {
		immichId: dto.id,
		checksum: dto.checksum,
		originalFileName: dto.originalFileName,
		mimeType: dto.originalMimeType,
		width: dto.width ?? dto.exifInfo?.exifImageWidth ?? null,
		height: dto.height ?? dto.exifInfo?.exifImageHeight ?? null,
		fileCreatedAt: dto.fileCreatedAt ? new Date(dto.fileCreatedAt) : null,
		cameraMake: dto.exifInfo?.make ?? null,
		cameraModel: dto.exifInfo?.model ?? null,
		ocrText,
		prefilterScore: score,
		prefilterSignals: signals as Prisma.InputJsonValue,
		smartHits,
		triageStatus: newStatus,
	};

	let assetId: string;
	if (existing) {
		const updated = await db().immichAsset.update({
			where: { id: existing.id },
			data: assetData,
		});
		assetId = updated.id;
	} else {
		const created = await db().immichAsset.create({
			data: assetData,
		});
		assetId = created.id;
	}

	if (shouldEnqueue) {
		await enqueue(triageClassify, { immichAssetId: assetId });
	}
}

async function runSmartQueries(
	client: ImmichClient,
	threshold: number,
	createdAfter?: string,
): Promise<void> {
	const queries = await getSetting("immich.smartQueries");
	for (const q of queries) {
		const query = q.trim();
		if (!query) continue;
		const page = await client.searchSmart({
			query,
			size: SMART_BATCH_SIZE,
			type: "IMAGE",
			...(createdAfter ? { createdAfter } : {}),
		});
		for (const item of page.items) {
			await processAsset(client, item, threshold, {
				additionalSmartHit: query,
			});
		}
	}
}

/**
 * Runs the sync scan between Immich and the local database (docs/contract.md "immich.scan").
 * - Default mode: incremental once backfill is done, otherwise backfill, whatever the payload says.
 * - Backfill resumes from SyncState.backfillPage.
 * - Incremental uses updatedAfter cursor.
 */
export async function runScan(
	_mode?: "backfill" | "incremental",
): Promise<void> {
	if (!features().immich) {
		console.log("[immich] sync skipped: features().immich is false");
		return;
	}

	let syncState = await db().syncState.findUnique({
		where: { id: "immich" },
	});
	if (!syncState) {
		syncState = await db().syncState.create({
			data: { id: "immich" },
		});
	}

	const effectiveMode = syncState.backfillDone ? "incremental" : "backfill";
	const threshold = await getSetting("prefilter.threshold");
	const client = immich();

	try {
		if (effectiveMode === "backfill") {
			// 1. Run smart search queries once per backfill
			if (!syncState.smartDone) {
				await runSmartQueries(client, threshold);
				syncState = await db().syncState.update({
					where: { id: "immich" },
					data: { smartDone: true },
				});
			}

			// 2. Page through metadata search ordered asc by updatedAt, size 500
			let currentPage = syncState.backfillPage;
			let maxUpdatedAtSeen = syncState.cursor
				? new Date(syncState.cursor)
				: null;

			while (true) {
				const page = await client.searchMetadata({
					page: currentPage,
					size: BATCH_SIZE,
					type: "IMAGE",
					withExif: true,
					withDeleted: true,
					order: "asc",
				});

				for (const item of page.items) {
					if (item.type !== "IMAGE") {
						continue;
					}
					if (item.updatedAt) {
						const d = new Date(item.updatedAt);
						if (!maxUpdatedAtSeen || d > maxUpdatedAtSeen) {
							maxUpdatedAtSeen = d;
						}
					}
					await processAsset(client, item, threshold);
				}

				if (page.nextPage && page.items.length > 0) {
					const nextPageIndex = parseInt(page.nextPage, 10);
					currentPage = Number.isNaN(nextPageIndex)
						? currentPage + 1
						: nextPageIndex;
					await db().syncState.update({
						where: { id: "immich" },
						data: {
							backfillPage: currentPage,
							cursor: maxUpdatedAtSeen?.toISOString() ?? syncState.cursor,
						},
					});
				} else {
					// Backfill complete
					await db().syncState.update({
						where: { id: "immich" },
						data: {
							backfillDone: true,
							cursor: maxUpdatedAtSeen?.toISOString() ?? syncState.cursor,
						},
					});
					break;
				}
			}
		} else {
			// Incremental sync:
			// 1. Run smart queries with createdAfter
			await runSmartQueries(client, threshold, syncState.cursor ?? undefined);

			// 2. Page metadata search with updatedAfter = cursor
			let incrementalPage = 1;
			let maxUpdatedAtSeen = syncState.cursor
				? new Date(syncState.cursor)
				: null;

			while (true) {
				const page = await client.searchMetadata({
					page: incrementalPage,
					size: BATCH_SIZE,
					type: "IMAGE",
					withExif: true,
					withDeleted: true,
					updatedAfter: syncState.cursor ?? undefined,
					order: "asc",
				});

				for (const item of page.items) {
					if (item.type !== "IMAGE") {
						continue;
					}
					if (item.updatedAt) {
						const d = new Date(item.updatedAt);
						if (!maxUpdatedAtSeen || d > maxUpdatedAtSeen) {
							maxUpdatedAtSeen = d;
						}
					}
					await processAsset(client, item, threshold);
				}

				if (page.nextPage && page.items.length > 0) {
					const nextPageIndex = parseInt(page.nextPage, 10);
					incrementalPage = Number.isNaN(nextPageIndex)
						? incrementalPage + 1
						: nextPageIndex;
				} else {
					break;
				}
			}

			if (maxUpdatedAtSeen) {
				await db().syncState.update({
					where: { id: "immich" },
					data: {
						cursor: maxUpdatedAtSeen.toISOString(),
					},
				});
			}
		}

		await db().syncState.update({
			where: { id: "immich" },
			data: {
				lastRunAt: new Date(),
				lastError: null,
			},
		});
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await db()
			.syncState.upsert({
				where: { id: "immich" },
				create: {
					id: "immich",
					lastRunAt: new Date(),
					lastError: errorMessage,
				},
				update: {
					lastRunAt: new Date(),
					lastError: errorMessage,
				},
			})
			.catch(() => {});
		throw err;
	}
}
