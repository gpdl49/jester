import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/instagram/crypto";
import {
	createGraphClient,
	type GraphClient,
	GraphError,
} from "@/lib/instagram/graph";
import { renderPost } from "@/lib/instagram/render";
import { renderCaption } from "@/lib/posts/caption";
import {
	headObject,
	INSTAGRAM_URL_TTL_SECONDS,
	instagramKey,
	presignGet,
} from "@/lib/s3";
import { getSetting } from "@/lib/settings";

export type PublishOptions = {
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
	graphClient?: GraphClient;
	fetch?: typeof fetch;
};

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes the Instagram publishing state machine for a post:
 * - Checks status (only queued or publishing proceeds)
 * - Checks publishing.paused setting
 * - Resolves account and decrypts token
 * - Enforces content publishing rate limit (used >= 95 -> defer 1h)
 * - Ensures renditions are in S3
 * - Reuses or creates containers (single or carousel)
 * - Polls container status (every 5s up to 2m)
 * - Checks recentMedia to avoid double-posting
 * - Publishes container, retrieves permalink, updates post & audits
 * - Handles retries (<3 attempts back off 5*attempts min; >=3 fails; expired token fails immediately)
 */
export async function publishPost(
	postId: string,
	options: PublishOptions = {},
): Promise<void> {
	const nowFn = options.now ?? (() => new Date());
	const sleepFn = options.sleep ?? defaultSleep;

	const post = await db().post.findUnique({
		where: { id: postId },
		include: {
			account: true,
			items: {
				include: { meme: true },
				orderBy: { position: "asc" },
			},
		},
	});

	if (!post) {
		return;
	}

	// Only queued or publishing proceed; everything else is a no-op
	if (post.status !== "queued" && post.status !== "publishing") {
		return;
	}

	// Skip and re-queue when publishing is paused
	const paused = await getSetting("publishing.paused");
	if (paused) {
		await db().post.update({
			where: { id: postId },
			data: {
				status: "queued",
				scheduledAt: null,
			},
		});
		return;
	}

	const newAttempts = post.attempts + 1;
	await db().post.update({
		where: { id: postId },
		data: {
			status: "publishing",
			attempts: newAttempts,
		},
	});

	try {
		// Resolve the Instagram account
		let account = post.account;
		if (!account) {
			if (post.accountId) {
				account = await db().instagramAccount.findUnique({
					where: { id: post.accountId },
				});
			}
			if (!account) {
				account = await db().instagramAccount.findFirst({
					where: { isDefault: true },
				});
			}
			if (!account) {
				account = await db().instagramAccount.findFirst();
			}
		}

		if (!account) {
			const errorMsg = "no Instagram account";
			await db().post.update({
				where: { id: postId },
				data: {
					status: "failed",
					error: errorMsg,
				},
			});
			await audit({
				actorId: null,
				action: "post.fail",
				subjectType: "post",
				subjectId: postId,
				data: { error: errorMsg },
			});
			return;
		}

		const accessToken = decrypt(account.accessTokenEnc);
		const client =
			options.graphClient ??
			createGraphClient({
				fetch: options.fetch,
				defaultToken: accessToken,
				defaultIgUserId: account.igUserId,
			});

		// Check publishing limit
		const limit = await client.publishingLimit(account.igUserId, accessToken);
		if (limit.used >= 95) {
			const deferDate = new Date(nowFn().getTime() + 60 * 60 * 1000);
			await db().post.update({
				where: { id: postId },
				data: {
					status: "queued",
					scheduledAt: deferDate,
				},
			});
			return;
		}

		// Ensure rendered JPEG files exist in S3
		let needsRender = false;
		for (const item of post.items) {
			const head = await headObject(instagramKey(postId, item.position));
			if (!head) {
				needsRender = true;
				break;
			}
		}
		if (needsRender) {
			await renderPost(postId);
		}

		// Render the caption
		const { text: renderedCaption } = await renderCaption({
			caption: post.caption,
			items: post.items.map((item) => ({
				meme: {
					creditText: item.meme.creditText,
					hashtags: item.meme.hashtags,
				},
			})),
		});

		// Check if existing containers can be reused
		let containerIds = [...post.containerIds];
		let containerAt = post.containerAt;
		let canReuseContainers = false;

		const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;
		if (
			containerIds.length > 0 &&
			containerAt &&
			nowFn().getTime() - containerAt.getTime() < TWENTY_THREE_HOURS_MS
		) {
			const targetId = containerIds[containerIds.length - 1];
			if (targetId) {
				try {
					const statusRes = await client.containerStatus(targetId, accessToken);
					if (
						statusRes.status_code !== "EXPIRED" &&
						statusRes.status_code !== "ERROR"
					) {
						canReuseContainers = true;
					}
				} catch {
					canReuseContainers = false;
				}
			}
		}

		if (!canReuseContainers) {
			containerIds = [];
			containerAt = nowFn();

			const singleItem = post.items[0];
			if (post.items.length === 1 && singleItem) {
				const presignedUrl = await presignGet(
					instagramKey(postId, singleItem.position),
					{ expiresIn: INSTAGRAM_URL_TTL_SECONDS },
				);
				const altText =
					singleItem.altText ?? singleItem.meme.altText ?? undefined;

				const res = await client.createImageContainer({
					igUserId: account.igUserId,
					token: accessToken,
					imageUrl: presignedUrl,
					caption: renderedCaption,
					altText,
					isCarouselItem: false,
				});
				containerIds = [res.id];
			} else {
				const childIds: string[] = [];
				for (const item of post.items) {
					const presignedUrl = await presignGet(
						instagramKey(postId, item.position),
						{ expiresIn: INSTAGRAM_URL_TTL_SECONDS },
					);
					const altText = item.altText ?? item.meme.altText ?? undefined;

					const childRes = await client.createImageContainer({
						igUserId: account.igUserId,
						token: accessToken,
						imageUrl: presignedUrl,
						altText,
						isCarouselItem: true,
					});
					childIds.push(childRes.id);
				}

				const parentRes = await client.createCarouselContainer({
					igUserId: account.igUserId,
					token: accessToken,
					children: childIds,
					caption: renderedCaption,
				});
				containerIds = [...childIds, parentRes.id];
			}

			// Persist container ids BEFORE polling
			await db().post.update({
				where: { id: postId },
				data: {
					containerIds,
					containerAt,
					accountId: account.id,
				},
			});
		}

		// Target container to check and publish is the parent container
		const targetContainerId = containerIds[containerIds.length - 1];
		if (!targetContainerId) {
			throw new Error("No container ID available to publish");
		}

		// Poll container status every 5 seconds for up to 2 minutes (24 iterations)
		const MAX_POLLS = 24;
		let isReady = false;
		for (let poll = 0; poll < MAX_POLLS; poll++) {
			const statusRes = await client.containerStatus(
				targetContainerId,
				accessToken,
			);
			if (
				statusRes.status_code === "FINISHED" ||
				statusRes.status_code === "PUBLISHED"
			) {
				isReady = true;
				break;
			}
			if (
				statusRes.status_code === "ERROR" ||
				statusRes.status_code === "EXPIRED"
			) {
				throw new Error(
					`Container status failed with ${statusRes.status_code}`,
				);
			}

			// Wait 5 seconds before next check
			await sleepFn(5000);
		}

		if (!isReady) {
			throw new Error("Container processing timed out after 2 minutes");
		}

		// Before publishing, guard against a double post:
		// If recentMedia has an item created after containerAt whose caption equals the rendered caption, treat as success
		let publishedMediaId: string | undefined;
		let permalink: string | null = null;

		const recent = await client.recentMedia(account.igUserId, 10, accessToken);
		if (containerAt) {
			for (const mediaItem of recent.data) {
				const mediaDate = new Date(mediaItem.timestamp);
				if (
					mediaDate.getTime() >= containerAt.getTime() - 1000 &&
					mediaItem.caption === renderedCaption
				) {
					publishedMediaId = mediaItem.id;
					permalink = mediaItem.permalink ?? null;
					break;
				}
			}
		}

		// Publish if not already detected
		if (!publishedMediaId) {
			const pubRes = await client.publish(targetContainerId, {
				igUserId: account.igUserId,
				token: accessToken,
			});
			publishedMediaId = pubRes.id;

			try {
				const mediaInfo = await client.media(
					publishedMediaId,
					["permalink"],
					accessToken,
				);
				permalink = (mediaInfo.permalink as string) ?? null;
			} catch {
				permalink = null;
			}
		}

		const publishedAt = nowFn();
		await db().post.update({
			where: { id: postId },
			data: {
				status: "published",
				igMediaId: publishedMediaId,
				permalink,
				publishedAt,
				error: null,
			},
		});

		await audit({
			actorId: null,
			action: "post.publish",
			subjectType: "post",
			subjectId: postId,
			data: {
				igMediaId: publishedMediaId,
				permalink,
				accountId: account.id,
			},
		});
	} catch (err) {
		if (err instanceof GraphError && err.isTokenExpired) {
			const errorMsg = `Instagram token expired: ${err.message}`;
			await db().post.update({
				where: { id: postId },
				data: {
					status: "failed",
					error: errorMsg,
				},
			});
			await audit({
				actorId: null,
				action: "post.fail",
				subjectType: "post",
				subjectId: postId,
				data: { error: errorMsg },
			});
			return;
		}

		const errorMsg = err instanceof Error ? err.message : String(err);
		if (newAttempts < 3) {
			const backoffMs = 5 * newAttempts * 60 * 1000;
			await db().post.update({
				where: { id: postId },
				data: {
					status: "queued",
					scheduledAt: new Date(nowFn().getTime() + backoffMs),
					error: errorMsg,
				},
			});
		} else {
			await db().post.update({
				where: { id: postId },
				data: {
					status: "failed",
					error: errorMsg,
				},
			});
			await audit({
				actorId: null,
				action: "post.fail",
				subjectType: "post",
				subjectId: postId,
				data: { error: errorMsg },
			});
		}
	}
}
