import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

describe("instagram crypto", () => {
	const testKey = crypto.randomBytes(32).toString("base64");
	const otherKey = crypto.randomBytes(32).toString("base64");

	it("round-trips plaintext", () => {
		const secret = "EAABwzLIXnjYBA...instagram_token_value_12345";
		const encrypted = encrypt(secret, testKey);
		expect(encrypted).not.toBe(secret);
		const decrypted = decrypt(encrypted, testKey);
		expect(decrypted).toBe(secret);
	});

	it("fails when ciphertext is tampered", () => {
		const secret = "my-secret-access-token";
		const encrypted = encrypt(secret, testKey);
		const raw = Buffer.from(encrypted, "base64");
		// Tamper with ciphertext byte at the end
		raw[raw.length - 1] ^= 0xff;
		const tampered = raw.toString("base64");

		expect(() => decrypt(tampered, testKey)).toThrow();
	});

	it("fails with wrong key", () => {
		const secret = "my-secret-access-token";
		const encrypted = encrypt(secret, testKey);

		expect(() => decrypt(encrypted, otherKey)).toThrow();
	});

	it("fails when payload is too short", () => {
		const invalid = Buffer.from("short").toString("base64");
		expect(() => decrypt(invalid, testKey)).toThrow("Invalid encrypted token length");
	});
});
