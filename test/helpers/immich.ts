import { createHash, randomUUID } from "node:crypto";
import { setImmichClient } from "@/lib/immich/client";
import type {
	ImmichAssetDto,
	ImmichClient,
	ImmichPage,
	MetadataSearch,
	SmartSearch,
	ThumbnailSize,
} from "@/lib/immich/types";

export type FakeAsset = ImmichAssetDto & {
	bytes: Uint8Array;
	ocrText?: string | null;
	/** Smart-search queries that return this asset. */
	smartQueries?: string[];
};

/** A fake asset whose checksum matches its bytes (like Immich's). */
export function fakeAsset(
	overrides: Partial<FakeAsset> = {},
	bytes: Uint8Array = new TextEncoder().encode(`image-${randomUUID()}`),
): FakeAsset {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		checksum: createHash("sha1").update(bytes).digest("base64"),
		originalFileName: "Screenshot_20190501-120000.png",
		originalMimeType: "image/png",
		type: "IMAGE",
		fileCreatedAt: now,
		updatedAt: now,
		isTrashed: false,
		width: 1170,
		height: 2532,
		exifInfo: { make: null, model: null },
		bytes,
		...overrides,
	};
}

/**
 * An in-memory Immich for tests, installed as the app's client until
 * `restore()`. Records every call in `calls` and every deletion in `deleted`.
 */
export function installFakeImmich(initial: FakeAsset[] = []) {
	const assets = new Map(initial.map((a) => [a.id, a]));
	const deleted: { ids: string[]; force: boolean }[] = [];
	const calls: string[] = [];
	const strip = ({
		bytes: _b,
		ocrText: _o,
		smartQueries: _s,
		...dto
	}: FakeAsset) => dto as ImmichAssetDto;
	const pageOf = (list: FakeAsset[], page = 1, size = 250): ImmichPage => {
		const start = (page - 1) * size;
		const items = list.slice(start, start + size).map(strip);
		return {
			items,
			nextPage: start + size < list.length ? String(page + 1) : null,
		};
	};

	const client: ImmichClient = {
		async searchMetadata(q: MetadataSearch) {
			calls.push(`searchMetadata ${JSON.stringify(q)}`);
			let list = [...assets.values()].filter(
				(a) => q.withDeleted || !a.isTrashed,
			);
			if (q.updatedAfter) {
				list = list.filter((a) => a.updatedAt > (q.updatedAfter as string));
			}
			if (q.createdAfter) {
				list = list.filter((a) => a.fileCreatedAt > (q.createdAfter as string));
			}
			// Like the real search: takenAfter filters on fileCreatedAt (inclusive),
			// and results come ordered by fileCreatedAt.
			const takenAfter = (q as { takenAfter?: string }).takenAfter;
			if (takenAfter) {
				const t = new Date(takenAfter).getTime();
				list = list.filter((a) => new Date(a.fileCreatedAt).getTime() >= t);
			}
			list.sort((a, b) => {
				const byTaken =
					new Date(a.fileCreatedAt).getTime() -
					new Date(b.fileCreatedAt).getTime();
				const cmp = byTaken || a.updatedAt.localeCompare(b.updatedAt);
				return (q.order ?? "asc") === "asc" ? cmp : -cmp;
			});
			return pageOf(list, q.page, q.size);
		},
		async searchSmart(q: SmartSearch) {
			calls.push(`searchSmart ${q.query}`);
			const list = [...assets.values()].filter(
				(a) => !a.isTrashed && a.smartQueries?.includes(q.query),
			);
			return pageOf(list, q.page, q.size);
		},
		async getAsset(id) {
			calls.push(`getAsset ${id}`);
			const a = assets.get(id);
			return a ? strip(a) : null;
		},
		async getOcrText(id) {
			return assets.get(id)?.ocrText ?? null;
		},
		async downloadOriginal(id) {
			calls.push(`downloadOriginal ${id}`);
			const a = assets.get(id);
			if (!a) {
				throw Object.assign(new Error("not found"), { status: 404 });
			}
			return {
				body: new Blob([a.bytes as BlobPart]).stream(),
				contentType: a.originalMimeType,
				size: a.bytes.byteLength,
			};
		},
		async getThumbnail(id, size: ThumbnailSize) {
			calls.push(`getThumbnail ${id} ${size}`);
			const a = assets.get(id);
			if (!a) {
				throw Object.assign(new Error("not found"), { status: 404 });
			}
			return { bytes: a.bytes, contentType: "image/jpeg" };
		},
		async deleteAssets(ids, { force }) {
			calls.push(`deleteAssets ${ids.join(",")} force=${force}`);
			deleted.push({ ids, force });
			for (const id of ids) {
				if (force) {
					assets.delete(id);
				} else {
					const a = assets.get(id);
					if (a) {
						a.isTrashed = true;
					}
				}
			}
		},
	};
	setImmichClient(client);
	return {
		client,
		assets,
		deleted,
		calls,
		add(asset: FakeAsset) {
			assets.set(asset.id, asset);
		},
		restore() {
			setImmichClient(undefined);
		},
	};
}

export type FakeImmich = ReturnType<typeof installFakeImmich>;
