import { afterEach, describe, expect, it } from "vitest";
import {
	getReverseImageSearchProvider,
	NoopReverseImageSearch,
	type ReverseImageSearchProvider,
	setReverseImageSearchProvider,
} from "./reverse-image";

describe("ReverseImageSearchProvider", () => {
	afterEach(() => {
		setReverseImageSearchProvider(undefined);
	});

	it("defaults to NoopReverseImageSearch which returns empty array", async () => {
		const provider = getReverseImageSearchProvider();
		expect(provider).toBeInstanceOf(NoopReverseImageSearch);
		expect(provider.name).toBe("noop");

		const results = await provider.search(new Uint8Array([1, 2, 3]));
		expect(results).toEqual([]);
	});

	it("allows custom provider to be configured", async () => {
		const mockProvider: ReverseImageSearchProvider = {
			name: "mock-lens",
			search: async () => [
				{
					url: "https://twitter.com/creator/status/1",
					title: "Original comic",
					source: "Twitter",
				},
			],
		};

		setReverseImageSearchProvider(mockProvider);
		const provider = getReverseImageSearchProvider();
		expect(provider.name).toBe("mock-lens");

		const results = await provider.search(new Uint8Array([4, 5, 6]));
		expect(results).toHaveLength(1);
		expect(results[0]?.url).toBe("https://twitter.com/creator/status/1");
	});
});
