import { describe, expect, it } from "vitest";
import { initialUploadState, uploadReducer } from "./upload-reducer";

describe("uploadReducer", () => {
	it("adds valid files as queued", () => {
		const file = new File(["dummy"], "meme.png", { type: "image/png" });
		const state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [file],
		});

		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.status).toBe("queued");
		expect(state.items[0]?.file.name).toBe("meme.png");
		expect(state.items[0]?.error).toBeUndefined();
	});

	it("flags unsupported format immediately as error", () => {
		const file = new File(["dummy"], "document.pdf", {
			type: "application/pdf",
		});
		const state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [file],
		});

		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.status).toBe("error");
		expect(state.items[0]?.error).toContain("Unsupported format");
	});

	it("flags files exceeding 25 MiB as error", () => {
		// Mock large file size
		const largeFile = new File([""], "huge.png", { type: "image/png" });
		Object.defineProperty(largeFile, "size", { value: 26 * 1024 * 1024 });

		const state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [largeFile],
		});

		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.status).toBe("error");
		expect(state.items[0]?.error).toContain("25 MiB");
	});

	it("tracks upload progress and completion lifecycle", () => {
		const file = new File(["1234"], "cat.jpg", { type: "image/jpeg" });
		let state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [file],
		});
		const itemId = state.items[0]?.id ?? "";

		// Start upload
		state = uploadReducer(state, {
			type: "START_UPLOAD",
			id: itemId,
			uploadId: "upl-123",
		});
		expect(state.items[0]?.status).toBe("uploading");
		expect(state.items[0]?.uploadId).toBe("upl-123");

		// Progress update
		state = uploadReducer(state, {
			type: "SET_PROGRESS",
			id: itemId,
			progress: 55,
		});
		expect(state.items[0]?.progress).toBe(55);

		// Completing
		state = uploadReducer(state, {
			type: "SET_COMPLETING",
			id: itemId,
		});
		expect(state.items[0]?.status).toBe("completing");
		expect(state.items[0]?.progress).toBe(100);

		// Processing
		state = uploadReducer(state, {
			type: "SET_PROCESSING",
			id: itemId,
		});
		expect(state.items[0]?.status).toBe("processing");

		// Imported with memeId
		state = uploadReducer(state, {
			type: "SET_IMPORTED",
			id: itemId,
			memeId: "meme-abc",
		});
		expect(state.items[0]?.status).toBe("imported");
		expect(state.items[0]?.memeId).toBe("meme-abc");
	});

	it("handles failure and retry", () => {
		const file = new File(["test"], "dog.webp", { type: "image/webp" });
		let state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [file],
		});
		const itemId = state.items[0]?.id ?? "";

		// Set error
		state = uploadReducer(state, {
			type: "SET_ERROR",
			id: itemId,
			error: "Network failure",
		});
		expect(state.items[0]?.status).toBe("error");
		expect(state.items[0]?.error).toBe("Network failure");

		// Retry resets to queued
		state = uploadReducer(state, {
			type: "RETRY",
			id: itemId,
		});
		expect(state.items[0]?.status).toBe("queued");
		expect(state.items[0]?.error).toBeUndefined();
		expect(state.items[0]?.progress).toBe(0);
	});

	it("removes items and clears finished items", () => {
		const f1 = new File(["1"], "1.png", { type: "image/png" });
		const f2 = new File(["2"], "2.png", { type: "image/png" });
		let state = uploadReducer(initialUploadState, {
			type: "ADD_FILES",
			files: [f1, f2],
		});
		const [i1, i2] = state.items;

		// Mark i1 imported
		state = uploadReducer(state, {
			type: "SET_IMPORTED",
			id: i1?.id ?? "",
			memeId: "meme-1",
		});

		// Clear finished removes i1, keeps i2
		state = uploadReducer(state, { type: "CLEAR_FINISHED" });
		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.id).toBe(i2?.id);

		// Remove i2
		state = uploadReducer(state, { type: "REMOVE", id: i2?.id ?? "" });
		expect(state.items).toHaveLength(0);
	});
});
