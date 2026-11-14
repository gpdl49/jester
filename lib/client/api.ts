/**
 * Typed browser client for the HTTP API (docs/memes.md "HTTP API"). Every
 * response shape comes from lib/api/types.ts; every non-2xx response is thrown
 * as an ApiError carrying the contract's `{error, message}` and the status.
 *
 * Runs in the browser behind oauth2-proxy, so requests are same-origin and the
 * session cookie rides along; nothing here is server-only.
 */

import type { MeDto } from "@/lib/api/types";

/** A non-2xx API response (or a response that is not the JSON we expected). */
export class ApiError extends Error {
	/** Stable machine code from the body, e.g. `not_found`, `conflict`. */
	readonly error: string;
	readonly status: number;

	constructor(status: number, error: string, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.error = error;
	}
}

export function isApiError(err: unknown, status?: number): err is ApiError {
	return (
		err instanceof ApiError && (status === undefined || err.status === status)
	);
}

/**
 * The request was turned away for want of a sign-in: a 401, or oauth2-proxy
 * redirecting an expired session to sign-in (which the client reports as a
 * 401). Reloading the page signs in again; retrying the request does not help.
 */
export function isSignInExpired(err: unknown): err is ApiError {
	return isApiError(err, 401);
}

/**
 * Worth retrying with the same request (and Idempotency-Key): network
 * failures and timeouts (fetch rejects with a TypeError, or a DOMException
 * when aborted), 408/425/429, 5xx, and a 409 `idempotency_in_progress` (an
 * earlier attempt with the same key is still running on the server). Every
 * other API error, including an expired sign-in, is permanent.
 */
export function isRetryable(err: unknown): boolean {
	if (err instanceof ApiError) {
		return (
			err.status === 0 ||
			(err.status === 409 && err.error === "idempotency_in_progress") ||
			err.status === 408 ||
			err.status === 425 ||
			err.status === 429 ||
			err.status >= 500
		);
	}
	return (
		err instanceof TypeError ||
		(err instanceof DOMException &&
			(err.name === "AbortError" || err.name === "TimeoutError"))
	);
}

const SIGN_IN_EXPIRED =
	"Your session has expired. Reload the page to sign in again.";

function signInExpired(): ApiError {
	return new ApiError(401, "unauthorized", SIGN_IN_EXPIRED);
}

/** Codes for responses without a contract body (proxy errors, crashes). */
const FALLBACK_CODES: Record<number, string> = {
	400: "bad_request",
	401: "unauthorized",
	403: "forbidden",
	404: "not_found",
	409: "conflict",
	422: "unprocessable",
	500: "internal",
};

// ---------------------------------------------------------------------------
// Request inputs (the response types live in lib/api/types.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
	query?: Query;
	body?: unknown;
	signal?: AbortSignal;
	/**
	 * Sent as `Idempotency-Key` (POST /items, /photos and /sessions honour it).
	 * A retry must send the same key and the same body: the server replays the
	 * first response, and 422s (`idempotency_key_reused`) when the body differs.
	 */
	idempotencyKey?: string;
}

/** Per-call options of the create calls that honour `Idempotency-Key`. */
export type CreateOptions = Pick<RequestOptions, "idempotencyKey" | "signal">;

export function toQueryString(query: Query | undefined): string {
	if (!query) {
		return "";
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "") {
			continue;
		}
		params.set(key, String(value));
	}
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

export interface ApiClientOptions {
	/** Prefix for every path; defaults to `/api` (same origin). */
	baseUrl?: string;
	/** Defaults to the global fetch, looked up per call (so tests can stub it). */
	fetch?: typeof fetch;
}

/**
 * oauth2-proxy answers a request with an expired session by redirecting to
 * sign-in. API calls fetch with `redirect: "manual"`, so the browser hands
 * back an opaque redirect (status 0) instead of chasing a cross-origin
 * redirect to the identity provider (which fails like a network error);
 * runtimes without opaque responses return the 3xx itself. A fetch that did
 * follow the redirect ends on an HTML page, flagged `redirected`.
 */
function isSignInRedirect(response: Response): boolean {
	return (
		response.type === "opaqueredirect" ||
		(response.status >= 300 && response.status < 400)
	);
}

export function createApiClient(options: ApiClientOptions = {}) {
	const baseUrl = options.baseUrl ?? "/api";
	const doFetch: typeof fetch = (...args) =>
		(options.fetch ?? globalThis.fetch)(...args);

	async function request<T>(
		method: string,
		path: string,
		{ query, body, signal, idempotencyKey }: RequestOptions = {},
	): Promise<T> {
		const headers: Record<string, string> = { Accept: "application/json" };
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		if (idempotencyKey !== undefined) {
			headers["Idempotency-Key"] = idempotencyKey;
		}
		const response = await doFetch(`${baseUrl}${path}${toQueryString(query)}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
			credentials: "same-origin",
			redirect: "manual",
		});
		if (isSignInRedirect(response)) {
			throw signInExpired();
		}
		if (!response.ok) {
			throw await toApiError(response);
		}
		if (response.status === 204) {
			return undefined as T;
		}
		const type = response.headers.get("content-type") ?? "";
		if (!type.includes("json")) {
			if (response.redirected) {
				// oauth2-proxy's sign-in page, reached by following its redirect.
				throw signInExpired();
			}
			throw new ApiError(
				response.status,
				"bad_response",
				`Unexpected ${type || "empty"} response from ${path}`,
			);
		}
		return (await response.json()) as T;
	}

	const enc = encodeURIComponent;
	return {
		/** Low-level call; slice clients (lib/client/<slice>.ts) build on it. */
		request,
		get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
			request<T>("GET", path, { query, signal }),
		post: <T>(
			path: string,
			body?: unknown,
			options: Omit<RequestOptions, "body"> = {},
		) => request<T>("POST", path, { ...options, body }),
		patch: <T>(path: string, body: unknown) =>
			request<T>("PATCH", path, { body }),
		put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
		del: (path: string) => request<void>("DELETE", path),
		me: () => request<MeDto>("GET", "/me"),
		enc,
	};
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The app's client: same-origin `/api`. */
export const api = createApiClient();

async function toApiError(response: Response): Promise<ApiError> {
	const fallback = FALLBACK_CODES[response.status] ?? "http_error";
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	if (
		body &&
		typeof body === "object" &&
		"error" in body &&
		typeof body.error === "string"
	) {
		const message =
			"message" in body && typeof body.message === "string"
				? body.message
				: response.statusText || body.error;
		return new ApiError(response.status, body.error, message);
	}
	return new ApiError(
		response.status,
		fallback,
		response.statusText || `Request failed (${response.status})`,
	);
}
