import type {
	UploadCreatedDto,
	UploadDto,
	UploadStatus,
} from "@/lib/api/types";
import type { Viewer } from "@/lib/auth";
import { db } from "@/lib/db";
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	unprocessable,
} from "@/lib/http/errors";
import { importUpload } from "@/lib/jobs/definitions/import-upload";
import { enqueue } from "@/lib/jobs/queue";
import type { CreateUploadInput } from "@/lib/media/schema";
import {
	headObject,
	MAX_UPLOAD_BYTES,
	MEDIA_VARIANTS,
	type MediaVariant,
	memeKey,
	presignGet,
	presignPut,
	UPLOAD_CONTENT_TYPES,
	uploadKey,
} from "@/lib/s3";

export function toUploadDto(upload: {
	id: string;
	contentType: string;
	size: number;
	status: string;
	memeId: string | null;
	error: string | null;
	createdAt: Date;
}): UploadDto {
	return {
		id: upload.id,
		contentType: upload.contentType,
		size: upload.size,
		status: upload.status as UploadStatus,
		memeId: upload.memeId,
		error: upload.error,
		createdAt: upload.createdAt.toISOString(),
	};
}

/**
 * Creates a direct upload record and returns a presigned S3 PUT URL.
 * Validates contentType ∈ [jpg, png, webp, gif] (422 unsupported_format)
 * and size ≤ 25 MiB (422 too_large).
 */
export async function createUpload(
	input: CreateUploadInput,
	user: Viewer,
): Promise<UploadCreatedDto> {
	const allowedTypes = UPLOAD_CONTENT_TYPES as readonly string[];
	if (!allowedTypes.includes(input.contentType)) {
		throw unprocessable("Unsupported image format", "unsupported_format");
	}

	if (input.size <= 0 || input.size > MAX_UPLOAD_BYTES) {
		throw unprocessable("File exceeds 25 MiB limit", "too_large");
	}

	const upload = await db().upload.create({
		data: {
			uploaderId: user.id,
			contentType: input.contentType,
			size: input.size,
			status: "pending",
		},
	});

	const presigned = await presignPut(uploadKey(upload.id), input.contentType);

	return {
		upload: toUploadDto(upload),
		uploadUrl: presigned.url,
		uploadHeaders: presigned.headers,
	};
}

/**
 * Completes a direct upload:
 * - Checks HeadObject in S3 matches declared size, else 409 conflict.
 * - Idempotent if already complete or imported.
 * - Only the uploader or an admin can complete.
 * - Sets status complete and enqueues import.upload.
 */
export async function completeUpload(
	uploadId: string,
	user: Viewer,
): Promise<UploadDto> {
	const upload = await db().upload.findUnique({ where: { id: uploadId } });
	if (!upload) {
		throw notFound("Upload not found");
	}

	if (upload.uploaderId !== user.id && !user.isAdmin) {
		throw forbidden("Only the uploader or an admin can complete this upload");
	}

	if (upload.status === "complete" || upload.status === "imported") {
		return toUploadDto(upload);
	}

	const head = await headObject(uploadKey(upload.id));
	if (!head || head.size !== upload.size) {
		throw conflict(
			"Uploaded file does not match declared size or was not uploaded",
		);
	}

	const updated = await db().upload.update({
		where: { id: upload.id },
		data: { status: "complete" },
	});

	await enqueue(importUpload, { uploadId: upload.id });

	return toUploadDto(updated);
}

/**
 * Returns the upload status for the uploader or an admin.
 */
export async function getUpload(
	uploadId: string,
	user: Viewer,
): Promise<UploadDto> {
	const upload = await db().upload.findUnique({ where: { id: uploadId } });
	if (!upload) {
		throw notFound("Upload not found");
	}

	if (upload.uploaderId !== user.id && !user.isAdmin) {
		throw forbidden("Only the uploader or an admin can view this upload");
	}

	return toUploadDto(upload);
}

/**
 * Returns a presigned GET URL for a meme media variant (original, display, thumb).
 * - 400 for an unknown variant.
 * - 404 if meme does not exist.
 * - 404 for display/thumb until renditionsReady is true.
 */
export async function getMediaRedirectUrl(
	memeId: string,
	variant: string,
): Promise<string> {
	if (!MEDIA_VARIANTS.includes(variant as MediaVariant)) {
		throw badRequest(`Unknown media variant: ${variant}`);
	}

	const meme = await db().meme.findUnique({ where: { id: memeId } });
	if (!meme) {
		throw notFound("Meme not found");
	}

	if ((variant === "display" || variant === "thumb") && !meme.renditionsReady) {
		throw notFound("Renditions not ready");
	}

	const key = memeKey(meme.id, variant as MediaVariant, meme.contentType);
	return presignGet(key, { expiresIn: 300 });
}
