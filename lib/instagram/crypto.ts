import crypto from "node:crypto";
import { env } from "@/lib/env";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

function getKeyBuffer(keyOverride?: string): Buffer {
	const rawKey = keyOverride ?? env().TOKEN_ENCRYPTION_KEY;
	if (!rawKey) {
		throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
	}
	const buf = Buffer.from(rawKey, "base64");
	if (buf.length !== 32) {
		throw new Error(`TOKEN_ENCRYPTION_KEY must be 32 bytes, got ${buf.length}`);
	}
	return buf;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: base64(iv[12] | tag[16] | ciphertext)
 */
export function encrypt(plain: string, keyOverride?: string): string {
	const key = getKeyBuffer(keyOverride);
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	const ciphertext = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();

	const combined = Buffer.concat([iv, tag, ciphertext]);
	return combined.toString("base64");
}

/**
 * Decrypts a base64 ciphertext (iv[12] | tag[16] | ciphertext) using AES-256-GCM.
 */
export function decrypt(enc: string, keyOverride?: string): string {
	const key = getKeyBuffer(keyOverride);
	const combined = Buffer.from(enc, "base64");

	if (combined.length < IV_LENGTH + TAG_LENGTH) {
		throw new Error("Invalid encrypted token length");
	}

	const iv = combined.subarray(0, IV_LENGTH);
	const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
	const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);

	const decrypted = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return decrypted.toString("utf8");
}
