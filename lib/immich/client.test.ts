import { describe, expect, it } from "vitest";
import { createImmichClient } from "./client";
import { ImmichError } from "./types";

describe("createImmichClient", () => {
	const API_URL = "https://immich.example.com";
	const API_KEY = "test-api-key";

	it("sends x-api-key header and formats searchMetadata request", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		const stubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(
				JSON.stringify({
					assets: {
						items: [{ id: "asset-1", originalFileName: "test.png" }],
						nextPage: "2",
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		const page = await client.searchMetadata({
			page: 1,
			size: 500,
			type: "IMAGE",
			order: "asc",
		});

		expect(capturedUrl).toBe("https://immich.example.com/api/search/metadata");
		expect(capturedInit?.method).toBe("POST");
		const headers = new Headers(capturedInit?.headers);
		expect(headers.get("x-api-key")).toBe("test-api-key");
		expect(headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			page: 1,
			size: 500,
			type: "IMAGE",
			order: "asc",
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.id).toBe("asset-1");
		expect(page.nextPage).toBe("2");
	});

	it("formats searchSmart request", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		const stubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(
				JSON.stringify({
					assets: {
						items: [{ id: "smart-1", originalFileName: "smart.png" }],
						nextPage: null,
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		const page = await client.searchSmart({
			query: "funny cat meme",
			size: 250,
			type: "IMAGE",
		});

		expect(capturedUrl).toBe("https://immich.example.com/api/search/smart");
		expect(capturedInit?.method).toBe("POST");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			query: "funny cat meme",
			size: 250,
			type: "IMAGE",
		});
		expect(page.items).toHaveLength(1);
		expect(page.nextPage).toBeNull();
	});

	it("getAsset returns asset dto on 200, null on 404, throws ImmichError on 500", async () => {
		let currentStatus = 200;
		const stubFetch = (async (_input: RequestInfo | URL) => {
			if (currentStatus === 404) {
				return new Response("Not Found", { status: 404 });
			}
			if (currentStatus === 500) {
				return new Response(
					JSON.stringify({ message: "Internal server error" }),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					},
				);
			}
			return new Response(
				JSON.stringify({ id: "asset-123", originalFileName: "pic.jpg" }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		// 200
		const asset = await client.getAsset("asset-123");
		expect(asset?.id).toBe("asset-123");

		// 404 -> null
		currentStatus = 404;
		const missing = await client.getAsset("asset-missing");
		expect(missing).toBeNull();

		// 500 -> throws ImmichError
		currentStatus = 500;
		await expect(client.getAsset("asset-error")).rejects.toThrow(ImmichError);
		try {
			await client.getAsset("asset-error");
		} catch (err) {
			expect(err).toBeInstanceOf(ImmichError);
			expect((err as ImmichError).status).toBe(500);
			expect((err as ImmichError).message).toBe("Internal server error");
		}
	});

	it("getOcrText parses text, joins lines, returns null on 404, throws on 500", async () => {
		let bodyData: unknown = { text: "detected text here" };
		let currentStatus = 200;

		const stubFetch = (async () => {
			if (currentStatus === 404) {
				return new Response("Not Found", { status: 404 });
			}
			if (currentStatus === 500) {
				return new Response("Error", { status: 500 });
			}
			return new Response(JSON.stringify(bodyData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		// string text field
		expect(await client.getOcrText("id-1")).toBe("detected text here");

		// lines array
		bodyData = { lines: ["line 1", "line 2", "line 3"] };
		expect(await client.getOcrText("id-1")).toBe("line 1 line 2 line 3");

		// array of boxes
		bodyData = [{ text: "box 1" }, { text: "box 2" }];
		expect(await client.getOcrText("id-1")).toBe("box 1 box 2");

		// 404 -> null
		currentStatus = 404;
		expect(await client.getOcrText("id-missing")).toBeNull();

		// 500 -> throws ImmichError
		currentStatus = 500;
		await expect(client.getOcrText("id-err")).rejects.toThrow(ImmichError);
	});

	it("downloadOriginal streams body without 30s timeout and returns content info", async () => {
		let capturedInit: RequestInit | undefined;
		const fileBytes = new TextEncoder().encode("binary content");

		const stubFetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedInit = init;
			return new Response(new Blob([fileBytes]), {
				status: 200,
				headers: {
					"Content-Type": "image/png",
					"Content-Length": String(fileBytes.byteLength),
				},
			});
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		const result = await client.downloadOriginal("asset-stream");
		expect(capturedInit?.signal).toBeUndefined();
		expect(result.contentType).toBe("image/png");
		expect(result.size).toBe(fileBytes.byteLength);
		expect(result.body).toBeDefined();

		// Read stream
		const reader = result.body.getReader();
		const chunk = await reader.read();
		expect(new TextDecoder().decode(chunk.value)).toBe("binary content");
	});

	it("getThumbnail queries size parameter and returns bytes and content type", async () => {
		let capturedUrl = "";
		const thumbBytes = new Uint8Array([1, 2, 3, 4]);

		const stubFetch = (async (input: RequestInfo | URL) => {
			capturedUrl = String(input);
			return new Response(thumbBytes, {
				status: 200,
				headers: { "Content-Type": "image/jpeg" },
			});
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		const result = await client.getThumbnail("asset-1", "preview");
		expect(capturedUrl).toBe(
			"https://immich.example.com/api/assets/asset-1/thumbnail?size=preview",
		);
		expect(result.contentType).toBe("image/jpeg");
		expect(result.bytes).toEqual(thumbBytes);
	});

	it("deleteAssets sends DELETE /assets with ids and force, ignores 404, throws on 500", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		let currentStatus = 200;

		const stubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			if (currentStatus === 404) {
				return new Response("Not Found", { status: 404 });
			}
			if (currentStatus === 500) {
				return new Response(JSON.stringify({ message: "Delete failed" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(null, { status: 204 });
		}) as typeof fetch;

		const client = createImmichClient({
			url: API_URL,
			apiKey: API_KEY,
			fetch: stubFetch,
		});

		// 204 success
		await client.deleteAssets(["asset-1", "asset-2"], { force: true });
		expect(capturedUrl).toBe("https://immich.example.com/api/assets");
		expect(capturedInit?.method).toBe("DELETE");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			ids: ["asset-1", "asset-2"],
			force: true,
		});

		// 404 allowed (missing ids / already deleted)
		currentStatus = 404;
		await expect(
			client.deleteAssets(["asset-missing"], { force: true }),
		).resolves.toBeUndefined();

		// 500 throws ImmichError
		currentStatus = 500;
		await expect(
			client.deleteAssets(["asset-err"], { force: true }),
		).rejects.toThrow(ImmichError);
	});
});
