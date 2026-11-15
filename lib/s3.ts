import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	NotFound,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type Env, env } from "@/lib/env";

/**
 * Media storage. Object keys are the contract in docs/jester.md ("Object
 * keys"); always build them with the helpers below.
 */
export const MEDIA_VARIANTS = ["original", "display", "thumb"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/** Meta fetches the image some time after the container is created. */
export const INSTAGRAM_URL_TTL_SECONDS = 60 * 60;

const EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/heic": "heic",
	"image/heif": "heic",
};

/** File extension for an original of this MIME type (`bin` when unknown). */
export const extensionFor = (contentType: string) =>
	EXTENSIONS[contentType.toLowerCase()] ?? "bin";

export function memeKey(
	memeId: string,
	variant: MediaVariant,
	contentType?: string,
): string {
	switch (variant) {
		case "original":
			if (!contentType) {
				throw new Error("memeKey(original) needs the content type");
			}
			return `media/${memeId}/original.${extensionFor(contentType)}`;
		case "display":
			return `media/${memeId}/display.webp`;
		case "thumb":
			return `media/${memeId}/thumb.webp`;
	}
}

export const uploadKey = (uploadId: string) => `uploads/${uploadId}`;
export const instagramKey = (postId: string, position: number) =>
	`ig/${postId}/${position}.jpg`;

type S3Config = Pick<
	Env,
	"AWS_REGION" | "AWS_ACCESS_KEY_ID" | "AWS_SECRET_ACCESS_KEY" | "S3_ENDPOINT"
>;

/** Pure: a client for the given config. S3_ENDPOINT (MinIO) means path-style. */
export function createS3Client(config: S3Config): S3Client {
	return new S3Client({
		region: config.AWS_REGION,
		...(config.S3_ENDPOINT
			? { endpoint: config.S3_ENDPOINT, forcePathStyle: true }
			: {}),
		...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
			? {
					credentials: {
						accessKeyId: config.AWS_ACCESS_KEY_ID,
						secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
					},
				}
			: {}),
		// The SDK's default flexible checksums would add x-amz-checksum-* query
		// parameters to presigned PUTs that a browser upload cannot satisfy.
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
	});
}

let client: S3Client | undefined;

export function s3(): S3Client {
	client ??= createS3Client(env());
	return client;
}

/** Tests only: use this client (e.g. one with a stubbed `send`); undefined resets. */
export function setS3Client(override: S3Client | undefined): void {
	client = override;
}

const bucket = () => env().MEDIA_BUCKET;

export type PresignedPut = {
	url: string;
	/** Headers the browser must send with the PUT (they are signed). */
	headers: Record<string, string>;
	expiresIn: number;
};

export async function presignPut(
	key: string,
	contentType: string,
	options: { expiresIn?: number } = {},
): Promise<PresignedPut> {
	const expiresIn = options.expiresIn ?? UPLOAD_URL_TTL_SECONDS;
	const url = await getSignedUrl(
		s3(),
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			ContentType: contentType,
		}),
		// Sign Content-Type so the upload must be the declared type.
		{ expiresIn, signableHeaders: new Set(["content-type"]) },
	);
	return { url, headers: { "Content-Type": contentType }, expiresIn };
}

export async function presignGet(
	key: string,
	options: { expiresIn?: number } = {},
): Promise<string> {
	return getSignedUrl(
		s3(),
		new GetObjectCommand({ Bucket: bucket(), Key: key }),
		{
			expiresIn: options.expiresIn ?? DOWNLOAD_URL_TTL_SECONDS,
		},
	);
}

/** Server-side read. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
	const response = await s3().send(
		new GetObjectCommand({ Bucket: bucket(), Key: key }),
	);
	if (!response.Body) {
		throw new Error(`Empty body for s3://${bucket()}/${key}`);
	}
	return response.Body.transformToByteArray();
}

/**
 * Server-side write. With `sha256Base64` S3 verifies the body against it
 * (x-amz-checksum-sha256) and stores the checksum for later HeadObject checks.
 */
export async function putObject(
	key: string,
	body: Uint8Array,
	contentType: string,
	options: { sha256Base64?: string } = {},
): Promise<void> {
	await s3().send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: body,
			ContentType: contentType,
			...(options.sha256Base64
				? { ChecksumSHA256: options.sha256Base64, ChecksumAlgorithm: "SHA256" }
				: {}),
		}),
	);
}

/** Deletes up to 1000 keys per request; missing keys are not an error; throws when any key fails. */
export async function deleteObjects(keys: string[]): Promise<void> {
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000);
		const response = await s3().send(
			new DeleteObjectsCommand({
				Bucket: bucket(),
				Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
			}),
		);
		// Quiet mode only reports failures; a 200 can still carry per-key errors.
		const failed = response.Errors ?? [];
		if (failed.length > 0) {
			const detail = failed
				.map((e) => `${e.Key ?? "?"} (${e.Code ?? "unknown"})`)
				.join(", ");
			throw new Error(
				`Failed to delete ${failed.length} of ${batch.length} objects: ${detail}`,
			);
		}
	}
}

export type ObjectHead = {
	size: number;
	contentType: string | undefined;
	/** Base64 SHA-256 when the object was written with one. */
	sha256: string | undefined;
};

/** Server-side HEAD; null when the object does not exist. */
export async function headObject(key: string): Promise<ObjectHead | null> {
	try {
		const response = await s3().send(
			new HeadObjectCommand({
				Bucket: bucket(),
				Key: key,
				ChecksumMode: "ENABLED",
			}),
		);
		return {
			size: response.ContentLength ?? 0,
			contentType: response.ContentType,
			sha256: response.ChecksumSHA256?.split("-")[0],
		};
	} catch (err) {
		if (
			err instanceof NotFound ||
			(err as { $metadata?: { httpStatusCode?: number } }).$metadata
				?.httpStatusCode === 404
		) {
			return null;
		}
		throw err;
	}
}
