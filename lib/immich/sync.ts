import { db } from "@/lib/db";
import { features } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import { immich, type MetadataSearchWithTaken } from "@/lib/immich/client";
import { scorePrefilter } from "@/lib/immich/prefilter";
import type { ImmichAssetDto, ImmichClient } from "@/lib/immich/types";
import { importImmich } from "@/lib/jobs/definitions/import-immich";
import { triageClassify } from "@/lib/jobs/definitions/triage-classify";
import { enqueue } from "@/lib/jobs/queue";
import { getSetting } from "@/lib/settings";

const BATCH_SIZE = 500;
const SMART_BATCH_SIZE = 250;
/**
 * Incremental runs re-read this much before the cursor. `updatedAfter` is
 * exclusive and timestamps are millisecond-precise, so assets that tie with the
 * cursor (or commit just after the last page was read) would otherwise be
 * skipped forever. Processing an asset twice is harmless.
 */
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

/** How long an asset may sit in `accepted` without a meme before the sweep re-queues its import. */
const STUCK_ACCEPTED_MS = 30 * 60 * 1000;
const STUCK_SWEEP_LIMIT = 200;

const withOverlap = (cursor: string | null): string | undefined => {
	if (!cursor) return undefined;
	const t = new Date(cursor).getTime();
	return Number.isNaN(t)
		? undefined
		: new Date(t - CURSOR_OVERLAP_MS).toISOString();
};

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

/**
 * Accepting an asset and enqueueing its import are two steps; if the process
 * dies in between, the asset stays `accepted` with no job. Re-queue the import
 * of every asset accepted more than 30 minutes ago that still has no meme.
 * The singleton key keeps repeated sweeps from piling up jobs; the import is
 * idempotent anyway.
 */
export async function sweepStuckAccepted(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - STUCK_ACCEPTED_MS);
	const stuck = await db().immichAsset.findMany({
		where: {
			triageStatus: "accepted",
			memeId: null,
			OR: [{ decidedAt: { lt: cutoff } }, { decidedAt: null }],
		},
		select: { id: true },
		orderBy: { id: "asc" },
		take: STUCK_SWEEP_LIMIT,
	});
	for (const { id } of stuck) {
		await enqueue(
			importImmich,
			{ immichAssetId: id },
			{ singletonKey: id, singletonSeconds: STUCK_ACCEPTED_MS / 1000 },
		);
	}
	return stuck.length;
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
		for (const hit of page.items) {
			// Smart search may omit EXIF; scoring that as "no camera" would push real
			// photos over the threshold, so load the full asset first.
			const item =
				hit.exifInfo === undefined ? await client.getAsset(hit.id) : hit;
			if (!item) continue;
			await processAsset(client, item, threshold, {
				additionalSmartHit: query,
			});
		}
	}
}

/**
 * Runs the sync scan between Immich and the local database (docs/contract.md "immich.scan").
 * - Default mode: incremental once backfill is done, otherwise backfill, whatever the payload says.
 * - Backfill is keyset-paged by fileCreatedAt and resumes from SyncState.backfillCursor.
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

	// Independent of the scan itself: don't let a sweep failure block it.
	await sweepStuckAccepted().catch((err) =>
		console.error("[immich] stuck-accepted sweep failed", err),
	);

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

			// 2. Keyset backfill. Paging by index would skip an asset whenever one
			//    before the current page disappears mid-run (including our own
			//    immich.delete), so always ask for page 1 with takenAfter = the
			//    last fileCreatedAt seen (minus 1 ms; assets tied with it come
			//    back and are skipped by id). The cursor is persisted after every
			//    page; backfillPage only counts pages for the dashboard.
			const startedAt = syncState.backfillStartedAt ?? new Date();
			if (!syncState.backfillStartedAt) {
				syncState = await db().syncState.update({
					where: { id: "immich" },
					data: { backfillStartedAt: startedAt },
				});
			}

			let cursor = syncState.backfillCursor
				? new Date(syncState.backfillCursor)
				: null;
			if (cursor && Number.isNaN(cursor.getTime())) cursor = null;
			let pagesRead = syncState.backfillPage;
			let pageIndex = 1; // > 1 only while a full page of ties can't move the cursor
			const seen = new Set<string>();

			while (true) {
				const query: MetadataSearchWithTaken = {
					page: pageIndex,
					size: BATCH_SIZE,
					type: "IMAGE",
					withExif: true,
					withDeleted: true,
					order: "asc",
					...(cursor
						? { takenAfter: new Date(cursor.getTime() - 1).toISOString() }
						: {}),
				};
				const page = await client.searchMetadata(query);

				let maxTaken = cursor;
				for (const item of page.items) {
					if (item.fileCreatedAt) {
						const taken = new Date(item.fileCreatedAt);
						if (
							!Number.isNaN(taken.getTime()) &&
							(!maxTaken || taken > maxTaken)
						) {
							maxTaken = taken;
						}
					}
					if (item.type !== "IMAGE" || seen.has(item.id)) {
						continue;
					}
					seen.add(item.id);
					await processAsset(client, item, threshold);
				}

				if (!(page.nextPage && page.items.length > 0)) {
					// Backfill complete. Anything updated while it ran may have been
					// read before its update, so start the incremental cursor 5
					// minutes before the backfill began.
					await db().syncState.update({
						where: { id: "immich" },
						data: {
							backfillDone: true,
							backfillPage: pagesRead + 1,
							cursor: new Date(
								startedAt.getTime() - CURSOR_OVERLAP_MS,
							).toISOString(),
						},
					});
					break;
				}

				const advanced = maxTaken !== null && (!cursor || maxTaken > cursor);
				if (advanced) {
					cursor = maxTaken;
					pageIndex = 1;
				} else {
					const next = parseInt(page.nextPage, 10);
					pageIndex = Number.isNaN(next) ? pageIndex + 1 : next;
				}
				pagesRead += 1;
				await db().syncState.update({
					where: { id: "immich" },
					data: {
						backfillPage: pagesRead,
						backfillCursor: cursor?.toISOString() ?? null,
					},
				});
			}
		} else {
			// Incremental sync:
			// 1. Run smart queries with createdAfter
			await runSmartQueries(client, threshold, withOverlap(syncState.cursor));

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
					updatedAfter: withOverlap(syncState.cursor),
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
