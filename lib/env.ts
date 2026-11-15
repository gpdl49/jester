import { z } from "zod";

/**
 * Runtime configuration. The variables are the contract in docs/jester.md
 * ("App environment"). Parsed lazily on first use, never at import time, so
 * `next build` and /api/healthz work without any of them set.
 */

/** Kubernetes and compose often set unset values to "". Treat that as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
	z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
	z.preprocess((v) => (v === "" || v === undefined ? fallback : v), schema);

const bool = (fallback: "true" | "false") =>
	withDefault(
		z.enum(["true", "false"]).transform((v) => v === "true"),
		fallback,
	);

/** Model defaults (docs/jester.md). Prices per M tokens in/out, 2026-11. */
export const DEFAULT_TRIAGE_MODEL = "google/gemini-3.5-flash-lite"; // $0.30 / $2.50
export const DEFAULT_ANALYSIS_MODEL = "google/gemini-3.8-flash"; // $0.83 / $4.13
export const DEFAULT_ATTRIBUTION_MODEL = "google/gemini-3.8-flash"; // + web search

const envSchema = z
	.object({
		NODE_ENV: withDefault(
			z.enum(["development", "test", "production"]),
			"development",
		),
		DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
		JOBS_ENABLED: bool("true"),
		AUTH_MODE: withDefault(z.enum(["proxy", "dev"]), "proxy"),
		REQUIRED_GROUP: withDefault(z.string().min(1), "jester"),
		ADMIN_GROUP: withDefault(z.string().min(1), "jester-admin"),
		PUBLIC_URL: withDefault(z.url(), "http://localhost:3000"),

		AWS_REGION: withDefault(z.string().min(1), "eu-central-1"),
		AWS_ACCESS_KEY_ID: optional(z.string()),
		AWS_SECRET_ACCESS_KEY: optional(z.string()),
		MEDIA_BUCKET: withDefault(z.string().min(1), "centerpoint-jester-media"),
		/** Set for MinIO in dev/tests; switches the S3 client to path-style. */
		S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),

		/** base64 of 32 bytes; required to connect Instagram accounts. */
		TOKEN_ENCRYPTION_KEY: optional(z.string()),

		OPENROUTER_API_KEY: optional(z.string()),
		OPENROUTER_TRIAGE_MODEL: withDefault(
			z.string().min(1),
			DEFAULT_TRIAGE_MODEL,
		),
		OPENROUTER_ANALYSIS_MODEL: withDefault(
			z.string().min(1),
			DEFAULT_ANALYSIS_MODEL,
		),
		OPENROUTER_ATTRIBUTION_MODEL: withDefault(
			z.string().min(1),
			DEFAULT_ATTRIBUTION_MODEL,
		),
		AI_DAILY_BUDGET_USD: withDefault(z.coerce.number().nonnegative(), "3"),

		IMMICH_URL: withDefault(z.url(), "https://immich.vidur.xyz"),
		IMMICH_API_KEY: optional(z.string()),
		IMMICH_DELETE_ENABLED: bool("false"),
		IMMICH_SYNC_INTERVAL_MINUTES: withDefault(
			z.coerce.number().int().min(1).max(1440),
			"10",
		),

		INSTAGRAM_APP_ID: optional(z.string()),
		INSTAGRAM_APP_SECRET: optional(z.string()),
		INSTAGRAM_GRAPH_VERSION: withDefault(
			z.string().regex(/^v\d+\.\d+$/),
			"v25.0",
		),
		SCHEDULE_TIMEZONE: withDefault(z.string().min(1), "Asia/Kolkata"),
	})
	.superRefine((env, ctx) => {
		if (env.AUTH_MODE === "dev" && env.NODE_ENV === "production") {
			ctx.addIssue({
				code: "custom",
				path: ["AUTH_MODE"],
				message: "AUTH_MODE=dev is refused when NODE_ENV=production",
			});
		}
		if (Boolean(env.AWS_ACCESS_KEY_ID) !== Boolean(env.AWS_SECRET_ACCESS_KEY)) {
			ctx.addIssue({
				code: "custom",
				path: ["AWS_ACCESS_KEY_ID"],
				message:
					"set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither",
			});
		}
		if (
			env.TOKEN_ENCRYPTION_KEY &&
			Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64").length !== 32
		) {
			ctx.addIssue({
				code: "custom",
				path: ["TOKEN_ENCRYPTION_KEY"],
				message: "must be base64 of exactly 32 bytes",
			});
		}
		try {
			new Intl.DateTimeFormat("en", { timeZone: env.SCHEDULE_TIMEZONE });
		} catch {
			ctx.addIssue({
				code: "custom",
				path: ["SCHEDULE_TIMEZONE"],
				message: "unknown IANA time zone",
			});
		}
	});

export type Env = z.output<typeof envSchema>;

export class EnvError extends Error {
	constructor(readonly issues: string[]) {
		super(`Invalid environment:\n  ${issues.join("\n  ")}`);
		this.name = "EnvError";
	}
}

/** Pure: validate an environment record. Throws EnvError listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
	const result = envSchema.safeParse(source);
	if (!result.success) {
		throw new EnvError(
			result.error.issues.map(
				(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
			),
		);
	}
	return result.data;
}

let cached: Env | undefined;

/** The validated process environment, parsed once. */
export function env(): Env {
	cached ??= parseEnv(process.env);
	return cached;
}

/** Tests only: forget the cached environment after changing process.env. */
export function resetEnvCache(): void {
	cached = undefined;
}

/** Feature switches derived from which credentials are present. */
export const features = (e: Env = env()) => ({
	ai: Boolean(e.OPENROUTER_API_KEY),
	immich: Boolean(e.IMMICH_API_KEY),
	immichDelete: Boolean(e.IMMICH_API_KEY) && e.IMMICH_DELETE_ENABLED,
	instagram:
		Boolean(e.INSTAGRAM_APP_ID) &&
		Boolean(e.INSTAGRAM_APP_SECRET) &&
		Boolean(e.TOKEN_ENCRYPTION_KEY),
});
