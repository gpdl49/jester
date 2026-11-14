import { env } from "@/lib/env";
import type { ImmichClient } from "./types";

/**
 * The process-wide Immich client. Owned by the `immich` slice: replace
 * `createImmichClient` with the real fetch-based implementation (x-api-key
 * header, IMMICH_URL + "/api"). Keep `immich()` and `setImmichClient()`.
 */
export function createImmichClient(_config: {
	url: string;
	apiKey: string;
	fetch?: typeof fetch;
}): ImmichClient {
	throw new Error("lib/immich/client: not implemented");
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
