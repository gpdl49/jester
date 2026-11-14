export type UploadItemStatus =
	| "queued"
	| "uploading"
	| "completing"
	| "processing"
	| "imported"
	| "error";

export type UploadItem = {
	id: string;
	file: File;
	uploadId?: string;
	memeId?: string;
	status: UploadItemStatus;
	progress: number; // 0 - 100
	error?: string;
};

export type UploadState = {
	items: UploadItem[];
};

export type UploadAction =
	| { type: "ADD_FILES"; files: File[] }
	| { type: "START_UPLOAD"; id: string; uploadId: string }
	| { type: "SET_PROGRESS"; id: string; progress: number }
	| { type: "SET_COMPLETING"; id: string }
	| { type: "SET_PROCESSING"; id: string; memeId?: string }
	| { type: "SET_IMPORTED"; id: string; memeId: string }
	| { type: "SET_ERROR"; id: string; error: string }
	| { type: "RETRY"; id: string }
	| { type: "REMOVE"; id: string }
	| { type: "CLEAR_FINISHED" };

export const ACCEPTED_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
];
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB

export const initialUploadState: UploadState = {
	items: [],
};

let clientCounter = 0;

export function uploadReducer(
	state: UploadState,
	action: UploadAction,
): UploadState {
	switch (action.type) {
		case "ADD_FILES": {
			const newItems: UploadItem[] = action.files.map((file) => {
				const id = `upload-${file.name}-${file.size}-${Date.now()}-${++clientCounter}`;
				if (!ACCEPTED_TYPES.includes(file.type)) {
					return {
						id,
						file,
						status: "error",
						progress: 0,
						error: "Unsupported format. Must be JPEG, PNG, WebP or GIF.",
					};
				}
				if (file.size > MAX_FILE_SIZE) {
					return {
						id,
						file,
						status: "error",
						progress: 0,
						error: "File exceeds 25 MiB limit.",
					};
				}
				return {
					id,
					file,
					status: "queued",
					progress: 0,
				};
			});
			return { items: [...state.items, ...newItems] };
		}

		case "START_UPLOAD":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? {
								...item,
								status: "uploading",
								uploadId: action.uploadId,
								progress: 0,
								error: undefined,
							}
						: item,
				),
			};

		case "SET_PROGRESS":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? {
								...item,
								progress: Math.min(100, Math.max(0, action.progress)),
							}
						: item,
				),
			};

		case "SET_COMPLETING":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? { ...item, status: "completing", progress: 100 }
						: item,
				),
			};

		case "SET_PROCESSING":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? {
								...item,
								status: "processing",
								memeId: action.memeId ?? item.memeId,
							}
						: item,
				),
			};

		case "SET_IMPORTED":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? { ...item, status: "imported", memeId: action.memeId }
						: item,
				),
			};

		case "SET_ERROR":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? { ...item, status: "error", error: action.error }
						: item,
				),
			};

		case "RETRY":
			return {
				items: state.items.map((item) =>
					item.id === action.id
						? {
								...item,
								status: "queued",
								error: undefined,
								progress: 0,
								uploadId: undefined,
								memeId: undefined,
							}
						: item,
				),
			};

		case "REMOVE":
			return {
				items: state.items.filter((item) => item.id !== action.id),
			};

		case "CLEAR_FINISHED":
			return {
				items: state.items.filter((item) => item.status !== "imported"),
			};

		default:
			return state;
	}
}
