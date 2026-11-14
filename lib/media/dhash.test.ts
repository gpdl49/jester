import { describe, expect, it } from "vitest";
import { twoTone } from "@/test/fixtures/images";
import { computeDHash, hammingDistance } from "./dhash";

describe("dhash", () => {
	it("calculates 0 hamming distance for identical hashes", () => {
		const hash = "0123456789abcdef";
		expect(hammingDistance(hash, hash)).toBe(0);
	});

	it("calculates correct hamming distance for differing bits", () => {
		expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
		expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
		expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
		expect(hammingDistance("1000000000000000", "0000000000000001")).toBe(2);
	});

	it("computes a 16-hex char dHash from an image", async () => {
		const img = await (await twoTone(100, 100)).png().toBuffer();
		const hash = await computeDHash(img);
		expect(hash).toHaveLength(16);
		expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);

		// Identical image produces identical hash
		const hash2 = await computeDHash(img);
		expect(hash2).toBe(hash);
		expect(hammingDistance(hash, hash2)).toBe(0);
	});

	it("similar images have small hamming distance", async () => {
		const img1 = await (await twoTone(100, 100)).png().toBuffer();
		const img2 = await (await twoTone(200, 200)).png().toBuffer();
		const hash1 = await computeDHash(img1);
		const hash2 = await computeDHash(img2);
		expect(hammingDistance(hash1, hash2)).toBeLessThanOrEqual(2);
	});
});
