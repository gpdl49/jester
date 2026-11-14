import { describe, expect, it, vi } from "vitest";
import {
	ApiError,
	createApiClient,
	isApiError,
	isRetryable,
	isSignInExpired,
	toQueryString,
} from "./api";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function setup(...responses: Response[]) {
	const fetch = vi.fn<typeof globalThis.fetch>();
	for (const response of responses) {
		fetch.mockResolvedValueOnce(response);
	}
	return { fetch, api: createApiClient({ fetch }) };
}

function call(fetch: ReturnType<typeof setup>["fetch"], n = 0) {
	const [url, init] = fetch.mock.calls[n] ?? [];
	return {
		url: String(url),
		method: init?.method,
		body: init?.body ? JSON.parse(String(init.body)) : undefined,
		headers: init?.headers as Record<string, string> | undefined,
	};
}

describe("toQueryString", () => {
	it("drops empty values and encodes the rest", () => {
		expect(
			toQueryString({ q: "red coat", tag: undefined, cursor: "", limit: 48 }),
		).toBe("?q=red+coat&limit=48");
		expect(toQueryString({})).toBe("");
	});
});

describe("api client", () => {
	it("sends JSON bodies with the right method, path and query", async () => {
		const { fetch, api } = setup(json({}), json({}), json([]));
		await api.post("/memes/bulk", { ids: ["a"], action: "approve" });
		await api.patch(`/memes/${api.enc("a/b")}`, { rating: 5 });
		await api.get("/memes", { q: "drake", status: "approved", cursor: "" });
		expect(call(fetch, 0)).toMatchObject({
			url: "/api/memes/bulk",
			method: "POST",
			body: { ids: ["a"], action: "approve" },
		});
		expect(call(fetch, 1)).toMatchObject({
			url: "/api/memes/a%2Fb",
			method: "PATCH",
		});
		expect(call(fetch, 2).url).toBe("/api/memes?q=drake&status=approved");
	});

	it("returns undefined for 204", async () => {
		const { api } = setup(new Response(null, { status: 204 }));
		await expect(api.del("/memes/m1")).resolves.toBeUndefined();
	});

	it("throws ApiError with the contract body", async () => {
		const { api } = setup(
			json({ error: "conflict", message: "Post is publishing" }, 409),
		);
		const err = await api.del("/posts/p1").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({
			status: 409,
			error: "conflict",
			message: "Post is publishing",
		});
		expect(isApiError(err, 409)).toBe(true);
		expect(isApiError(err, 404)).toBe(false);
	});

	it("falls back to a status code when the body is not the contract shape", async () => {
		const { api } = setup(
			new Response("<html>Bad gateway</html>", {
				status: 502,
				statusText: "Bad Gateway",
			}),
		);
		await expect(api.get("/tags")).rejects.toMatchObject({
			status: 502,
			error: "http_error",
			message: "Bad Gateway",
		});
	});

	it("treats an HTML page after a redirect as an expired session", async () => {
		const page = new Response("<html>sign in</html>", {
			status: 200,
			headers: { "content-type": "text/html" },
		});
		Object.defineProperty(page, "redirected", { value: true });
		const { api } = setup(page);
		await expect(api.me()).rejects.toMatchObject({
			status: 401,
			error: "unauthorized",
		});
	});

	it("uses the global fetch when none is given", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json([]));
		vi.stubGlobal("fetch", fetch);
		try {
			await createApiClient().get("/tags");
			expect(fetch).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("sign-in expiry", () => {
	it("fetches API calls without following redirects", async () => {
		const { fetch, api } = setup(json([]));
		await api.get("/tags");
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			redirect: "manual",
			credentials: "same-origin",
		});
	});

	it("treats an opaque redirect (browser, redirect: manual) as an expired session", async () => {
		const opaque = {
			type: "opaqueredirect",
			status: 0,
			ok: false,
			redirected: false,
			statusText: "",
			headers: new Headers(),
		} as unknown as Response;
		const { api } = setup(opaque);
		const err = await api.get("/memes").catch((e: unknown) => e);
		expect(err).toMatchObject({ status: 401, error: "unauthorized" });
		expect(isSignInExpired(err)).toBe(true);
		expect(isRetryable(err)).toBe(false);
	});

	it("treats a bare 3xx (runtimes without opaque redirects) as an expired session", async () => {
		const { api } = setup(
			new Response(null, {
				status: 302,
				headers: { location: "/oauth2/sign_in" },
			}),
		);
		await expect(api.me()).rejects.toMatchObject({
			status: 401,
			error: "unauthorized",
		});
	});

	it("treats a 401 as an expired session", async () => {
		const { api } = setup(
			json({ error: "unauthorized", message: "Not signed in" }, 401),
		);
		const err = await api.me().catch((e: unknown) => e);
		expect(isSignInExpired(err)).toBe(true);
		expect(err).toMatchObject({ message: "Not signed in" });
	});

	it("does not treat other errors as an expired session", () => {
		expect(isSignInExpired(new ApiError(403, "forbidden", "no"))).toBe(false);
		expect(isSignInExpired(new TypeError("Failed to fetch"))).toBe(false);
	});
});

describe("isRetryable", () => {
	const api = (status: number, error = "x") =>
		new ApiError(status, error, "message");

	it("retries network failures, timeouts, throttling and server errors", () => {
		expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
		expect(isRetryable(new DOMException("aborted", "AbortError"))).toBe(true);
		expect(isRetryable(new DOMException("slow", "TimeoutError"))).toBe(true);
		for (const status of [408, 425, 429, 500, 502, 503, 504]) {
			expect(isRetryable(api(status)), String(status)).toBe(true);
		}
	});

	it("retries a 409 idempotency_in_progress, not other conflicts", () => {
		expect(isRetryable(api(409, "idempotency_in_progress"))).toBe(true);
		expect(isRetryable(api(409, "conflict"))).toBe(false);
	});

	it("does not retry other client errors or unknown errors", () => {
		for (const status of [400, 401, 403, 404, 422]) {
			expect(isRetryable(api(status)), String(status)).toBe(false);
		}
		expect(isRetryable(new Error("boom"))).toBe(false);
		expect(isRetryable(new DOMException("nope", "NotAllowedError"))).toBe(
			false,
		);
		expect(isRetryable("string")).toBe(false);
	});
});
