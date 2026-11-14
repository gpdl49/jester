/**
 * The Immich API surface the app uses (Immich v3, https://api.immich.app).
 * This interface is the contract between slices: `immich` implements it in
 * lib/immich/client.ts; `triage` and `media` call it through `immich()` and
 * swap in a fake with `setImmichClient()` in tests.
 */

/** Subset of Immich's AssetResponseDto. */
export type ImmichAssetDto = {
	id: string;
	/** base64 SHA-1 of the original file. */
	checksum: string;
	originalFileName: string;
	originalMimeType: string;
	type: "IMAGE" | "VIDEO" | "AUDIO" | "OTHER";
	fileCreatedAt: string;
	updatedAt: string;
	isTrashed: boolean;
	width?: number | null;
	height?: number | null;
	exifInfo?: {
		make?: string | null;
		model?: string | null;
		exifImageWidth?: number | null;
		exifImageHeight?: number | null;
	} | null;
};

export type ImmichPage = {
	items: ImmichAssetDto[];
	/** Immich returns the next page number as a string, or null at the end. */
	nextPage: string | null;
};

export type MetadataSearch = {
	page?: number;
	size?: number;
	type?: "IMAGE";
	withExif?: boolean;
	withDeleted?: boolean;
	updatedAfter?: string;
	createdAfter?: string;
	order?: "asc" | "desc";
};

export type SmartSearch = {
	query: string;
	page?: number;
	size?: number;
	type?: "IMAGE";
	createdAfter?: string;
};

export type ThumbnailSize = "thumbnail" | "preview" | "fullsize";

export type ImmichBytes = { bytes: Uint8Array; contentType: string };

export interface ImmichClient {
	searchMetadata(query: MetadataSearch): Promise<ImmichPage>;
	searchSmart(query: SmartSearch): Promise<ImmichPage>;
	/** null when the asset no longer exists. */
	getAsset(id: string): Promise<ImmichAssetDto | null>;
	/** OCR text Immich extracted for the asset, or null when there is none. */
	getOcrText(id: string): Promise<string | null>;
	/** The original file as a stream (large files: do not buffer). */
	downloadOriginal(id: string): Promise<{
		body: ReadableStream<Uint8Array>;
		contentType: string;
		size: number | null;
	}>;
	getThumbnail(id: string, size: ThumbnailSize): Promise<ImmichBytes>;
	/** `force: true` skips the trash (permanent). Missing ids are not an error. */
	deleteAssets(ids: string[], options: { force: boolean }): Promise<void>;
}

export class ImmichError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "ImmichError";
	}
}
