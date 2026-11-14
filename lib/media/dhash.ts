import sharp from "sharp";

/**
 * 64-bit difference hash (dHash).
 * 1. Convert to greyscale.
 * 2. Resize to 9x8 (9 columns, 8 rows).
 * 3. Compare adjacent pixels in each row (p[c] > p[c+1] ? 1 : 0).
 * 4. Yields 8x8 = 64 bits, formatted as 16 hex characters.
 */
export async function computeDHash(
	input: Buffer | Uint8Array,
): Promise<string> {
	const { data } = await sharp(input)
		.greyscale()
		.resize(9, 8, { fit: "fill" })
		.raw()
		.toBuffer({ resolveWithObject: true });

	let hash = 0n;
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const left = data[row * 9 + col] ?? 0;
			const right = data[row * 9 + col + 1] ?? 0;
			hash = (hash << 1n) | (left > right ? 1n : 0n);
		}
	}

	return hash.toString(16).padStart(16, "0");
}

/**
 * Hamming distance between two 16-hex dHash strings.
 * Counts differing bit positions (0 to 64).
 */
export function hammingDistance(a: string, b: string): number {
	const valA = BigInt(`0x${a}`);
	const valB = BigInt(`0x${b}`);
	let diff = valA ^ valB;
	let count = 0;
	while (diff > 0n) {
		if (diff & 1n) {
			count++;
		}
		diff >>= 1n;
	}
	return count;
}
