/**
 * Reverse image search provider interface and no-op implementation.
 * docs/jester.md "Attribution"
 */

export interface ReverseImageSearchResult {
	url: string;
	title?: string;
	source?: string;
}

export interface ReverseImageSearchProvider {
	name: string;
	search(image: Uint8Array): Promise<ReverseImageSearchResult[]>;
}

export class NoopReverseImageSearch implements ReverseImageSearchProvider {
	readonly name = "noop";

	async search(_image: Uint8Array): Promise<ReverseImageSearchResult[]> {
		return [];
	}
}

let currentProvider: ReverseImageSearchProvider = new NoopReverseImageSearch();

export function getReverseImageSearchProvider(): ReverseImageSearchProvider {
	return currentProvider;
}

/** Set the active reverse image search provider (e.g. for testing). */
export function setReverseImageSearchProvider(
	provider: ReverseImageSearchProvider | undefined,
): void {
	currentProvider = provider ?? new NoopReverseImageSearch();
}
