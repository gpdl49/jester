import { env } from "@/lib/env";
import {
	type ImmichAssetDto,
	type ImmichClient,
	ImmichError,
	type ImmichPage,
	type MetadataSearch,
	type SmartSearch,
	type ThumbnailSize,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The process-wide Immich client. Owned by the `immich` slice: replace
 * `createImmichClient` with the real fetch-based implementation (x-api-key
 * header, IMMICH_URL + "/api"). Keep `immich()` and `setImmichClient()`.
 */
export function createImmichClient(config: {
	url: string;
	apiKey: string;
	fetch?: typeof fetch;
}): ImmichClient {
	const fetchFn = config.fetch ?? fetch;
	const baseUrl = `${config.url.replace(/\/+$/, "")}/api`;

	async function request(
		path: string,
		init: RequestInit = {},
		options: { timeoutMs?: number; allow404?: boolean } = {},
	): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("x-api-key", config.apiKey);

		const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const signal =
			timeoutMs > 0
				? (init.signal ?? AbortSignal.timeout(timeoutMs))
				: init.signal;

		let response: Response;
		try {
			response = await fetchFn(url, {
				...init,
				headers,
				signal,
			});
		} catch (err: unknown) {
			if (err instanceof ImmichError) throw err;
			throw new ImmichError(
				err instanceof Error
					? err.message
					: `Immich request failed: ${String(err)}`,
			);
		}

		if (!response.ok) {
			if (options.allow404 && response.status === 404) {
				return response;
			}
			let message = `Immich request failed with status ${response.status}`;
			try {
				const body = (await response.json()) as Record<string, unknown>;
				if (typeof body.message === "string") {
					message = body.message;
				} else if (typeof body.error === "string") {
					message = body.error;
				}
			} catch {
				// Non-JSON response, keep default message
			}
			throw new ImmichError(message, response.status);
		}

		return response;
	}

	function parsePage(data: unknown): ImmichPage {
		const record = data as {
			assets?: { items?: ImmichAssetDto[]; nextPage?: string | number | null };
			items?: ImmichAssetDto[];
			nextPage?: string | number | null;
		};
		const container = record?.assets ?? record ?? {};
		const items = Array.isArray(container.items) ? container.items : [];
		const rawNext = container.nextPage;
		const nextPage = rawNext != null ? String(rawNext) : null;
		return { items, nextPage };
	}

	return {
		async searchMetadata(query: MetadataSearch): Promise<ImmichPage> {
			const res = await request("/search/metadata", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify(query),
			});
			const data = await res.json();
			return parsePage(data);
		},

		async searchSmart(query: SmartSearch): Promise<ImmichPage> {
			const res = await request("/search/smart", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify(query),
			});
			const data = await res.json();
			return parsePage(data);
		},

		async getAsset(id: string): Promise<ImmichAssetDto | null> {
			const res = await request(
				`/assets/${encodeURIComponent(id)}`,
				{
					method: "GET",
					headers: { accept: "application/json" },
				},
				{ allow404: true },
			);
			if (res.status === 404) {
				return null;
			}
			return (await res.json()) as ImmichAssetDto;
		},

		async getOcrText(id: string): Promise<string | null> {
			const res = await request(
				`/assets/${encodeURIComponent(id)}/ocr`,
				{
					method: "GET",
					headers: { accept: "application/json" },
				},
				{ allow404: true },
			);
			if (res.status === 404) {
				return null;
			}
			const data = (await res.json()) as unknown;
			if (!data) return null;
			if (typeof data === "string") return data.trim() || null;
			if (typeof (data as { text?: unknown }).text === "string") {
				return (data as { text: string }).text.trim() || null;
			}
			if (Array.isArray((data as { lines?: unknown[] }).lines)) {
				const lines = (data as { lines: unknown[] }).lines
					.map((line) => (typeof line === "string" ? line.trim() : ""))
					.filter(Boolean);
				return lines.length > 0 ? lines.join(" ") : null;
			}
			if (Array.isArray(data)) {
				const parts = data
					.map((item) => {
						if (typeof item === "string") return item.trim();
						if (item && typeof item === "object" && "text" in item) {
							return String((item as { text: unknown }).text ?? "").trim();
						}
						return "";
					})
					.filter(Boolean);
				return parts.length > 0 ? parts.join(" ") : null;
			}
			return null;
		},

		async downloadOriginal(id: string): Promise<{
			body: ReadableStream<Uint8Array>;
			contentType: string;
			size: number | null;
		}> {
			const res = await request(
				`/assets/${encodeURIComponent(id)}/original`,
				{ method: "GET" },
				{ timeoutMs: 0 },
			);
			if (!res.body) {
				throw new ImmichError(
					"Empty response body from Immich downloadOriginal",
				);
			}
			const contentType =
				res.headers.get("content-type") || "application/octet-stream";
			const lengthHeader = res.headers.get("content-length");
			const size = lengthHeader ? parseInt(lengthHeader, 10) : null;
			return {
				body: res.body as ReadableStream<Uint8Array>,
				contentType,
				size: Number.isNaN(size) ? null : size,
			};
		},

		async getThumbnail(id: string, size: ThumbnailSize) {
			const res = await request(
				`/assets/${encodeURIComponent(id)}/thumbnail?size=${encodeURIComponent(size)}`,
				{ method: "GET" },
			);
			const contentType = res.headers.get("content-type") || "image/jpeg";
			const buffer = await res.arrayBuffer();
			return {
				bytes: new Uint8Array(buffer),
				contentType,
			};
		},

		async deleteAssets(
			ids: string[],
			options: { force: boolean },
		): Promise<void> {
			const res = await request(
				"/assets",
				{
					method: "DELETE",
					headers: {
						"content-type": "application/json",
						accept: "application/json",
					},
					body: JSON.stringify({ ids, force: options.force }),
				},
				{ allow404: true },
			);
			// 404 is allowed (missing ids / already deleted)
			if (res.status === 404) {
				return;
			}
		},
	};
}

let client: ImmichClient | undefined;

export function immich(): ImmichClient {
	if (!client) {
		const e = env();
		if (!e.IMMICH_API_KEY) {
			throw new Error("IMMICH_API_KEY is not set");
		}
		client = createImmichClient({
			url: e.IMMICH_URL,
			apiKey: e.IMMICH_API_KEY,
		});
	}
	return client;
}

/** Tests only: use this client; undefined resets. */
export function setImmichClient(override: ImmichClient | undefined): void {
	client = override;
}
