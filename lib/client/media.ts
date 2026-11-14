import type { UploadCreatedDto, UploadDto } from "@/lib/api/types";
import { api } from "./api";

/**
 * Initiates a direct upload to S3.
 */
export async function createUpload(params: {
	contentType: string;
	size: number;
}): Promise<UploadCreatedDto> {
	return api.post<UploadCreatedDto>("/uploads", params);
}

/**
 * Notifies the server that an upload has finished transferring to S3.
 */
export async function completeUpload(uploadId: string): Promise<UploadDto> {
	return api.post<UploadDto>(`/uploads/${uploadId}/complete`);
}

/**
 * Retrieves the current status and linked meme of an upload.
 */
export async function getUpload(uploadId: string): Promise<UploadDto> {
	return api.get<UploadDto>(`/uploads/${uploadId}`);
}

/**
 * Uploads a file directly to the S3 presigned URL using XHR to report upload progress.
 */
export function uploadToPresignedUrl(
	url: string,
	headers: Record<string, string>,
	file: Blob,
	onProgress?: (progress: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		for (const [key, value] of Object.entries(headers)) {
			xhr.setRequestHeader(key, value);
		}
		if (xhr.upload && onProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) {
					onProgress(Math.round((e.loaded / e.total) * 100));
				}
			};
		}
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
			} else {
				reject(new Error(`S3 upload failed with status ${xhr.status}`));
			}
		};
		xhr.onerror = () => reject(new Error("Network error during S3 upload"));
		xhr.onabort = () => reject(new Error("S3 upload was aborted"));
		xhr.send(file);
	});
}
