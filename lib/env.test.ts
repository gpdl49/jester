import { describe, expect, it } from "vitest";
import { DEFAULT_TRIAGE_MODEL, EnvError, features, parseEnv } from "./env";

const base = { DATABASE_URL: "postgresql://x@localhost/memes" };

describe("parseEnv", () => {
	it("applies the contract defaults", () => {
		const e = parseEnv(base);
		expect(e.REQUIRED_GROUP).toBe("memes");
		expect(e.ADMIN_GROUP).toBe("memes-admin");
		expect(e.MEDIA_BUCKET).toBe("centerpoint-memes-media");
		expect(e.OPENROUTER_TRIAGE_MODEL).toBe(DEFAULT_TRIAGE_MODEL);
		expect(e.AI_DAILY_BUDGET_USD).toBe(3);
		expect(e.IMMICH_DELETE_ENABLED).toBe(false);
		expect(e.IMMICH_SYNC_INTERVAL_MINUTES).toBe(10);
		expect(e.JOBS_ENABLED).toBe(true);
	});

	it("treats empty strings as unset", () => {
		const e = parseEnv({ ...base, OPENROUTER_API_KEY: "", S3_ENDPOINT: "" });
		expect(e.OPENROUTER_API_KEY).toBeUndefined();
		expect(e.S3_ENDPOINT).toBeUndefined();
	});

	it("refuses dev auth in production", () => {
		expect(() =>
			parseEnv({ ...base, AUTH_MODE: "dev", NODE_ENV: "production" }),
		).toThrow(EnvError);
	});

	it("checks the token key length and the time zone", () => {
		expect(() =>
			parseEnv({
				...base,
				TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
			}),
		).toThrow(/TOKEN_ENCRYPTION_KEY/);
		expect(() =>
			parseEnv({ ...base, SCHEDULE_TIMEZONE: "Mars/Olympus" }),
		).toThrow(/SCHEDULE_TIMEZONE/);
	});
});

describe("features", () => {
	it("derives switches from credentials", () => {
		expect(features(parseEnv(base))).toEqual({
			ai: false,
			immich: false,
			immichDelete: false,
			instagram: false,
		});
		const all = parseEnv({
			...base,
			OPENROUTER_API_KEY: "k",
			IMMICH_API_KEY: "k",
			IMMICH_DELETE_ENABLED: "true",
			INSTAGRAM_APP_ID: "1",
			INSTAGRAM_APP_SECRET: "s",
			TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
		});
		expect(features(all)).toEqual({
			ai: true,
			immich: true,
			immichDelete: true,
			instagram: true,
		});
	});
});
