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
import { INSTAGRAM_URL_TTL_SECONDS, instagramKey, presignGet } from "@/lib/s3";
import { getSetting } from "@/lib/settings";

export type PublishOptions = {
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
	graphClient?: GraphClient;
	fetch?: typeof fetch;
};

/** A post stuck in `publishing` this long belongs to a crashed worker. */
export const PUBLISHING_STALE_MS = 10 * 60 * 1000;

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

	// Only queued posts, or publishing posts abandoned by a crashed worker,
	// proceed; everything else is a no-op.
	const now = nowFn();
	const staleBefore = new Date(now.getTime() - PUBLISHING_STALE_MS);
	const claimable =
		post.status === "queued" ||
		(post.status === "publishing" && post.updatedAt < staleBefore);
	if (!claimable) {
		return;
	}

	// Skip and re-queue when publishing is paused (does not use up an attempt)
	const paused = await getSetting("publishing.paused");
	if (paused) {
		await db().post.updateMany({
			where: { id: postId, status: { in: ["queued", "publishing"] } },
			data: { status: "queued", scheduledAt: null },
		});
		return;
	}

	// Atomic claim: only one caller moves the post to publishing. Two jobs (a
	// duplicate enqueue, a pg-boss retry) must never publish the same post.
	const newAttempts = post.attempts + 1;
	const claim = await db().post.updateMany({
		where: {
			id: postId,
			attempts: post.attempts,
			OR: [
				{ status: "queued" },
				{ status: "publishing", updatedAt: { lt: staleBefore } },
			],
		},
		data: { status: "publishing", attempts: newAttempts },
	});
	if (claim.count === 0) {
		return;
	}

	// A previous attempt may have reached media_publish before failing.
	const mayHaveBeenPublished = post.attempts > 0;

	/** Back to the queue without using up the attempt (rate limits). */
	const deferPost = async (until: Date, error: string | null) => {
		await db().post.update({
			where: { id: postId },
			data: {
				status: "queued",
				scheduledAt: until,
				attempts: post.attempts,
				error,
			},
		});
	};

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

		if (account.tokenExpiresAt.getTime() <= nowFn().getTime()) {
			const errorMsg = "Instagram token expired: reconnect the account";
			await db().post.update({
				where: { id: postId },
				data: { status: "failed", error: errorMsg },
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
			await deferPost(new Date(nowFn().getTime() + 60 * 60 * 1000), null);
			return;
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
			// Always render fresh: the post's memes may have changed since an
			// earlier render, and a stale rendition would publish the wrong image.
			await renderPost(postId);

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
		let containerPublished = false;
		for (let poll = 0; poll < MAX_POLLS; poll++) {
			const statusRes = await client.containerStatus(
				targetContainerId,
				accessToken,
			);
			if (
				statusRes.status_code === "FINISHED" ||
				statusRes.status_code === "PUBLISHED"
			) {
				containerPublished = statusRes.status_code === "PUBLISHED";
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
		// On a retry (an earlier attempt may have reached media_publish), if recentMedia has
		// an unclaimed item created after containerAt with our caption, treat it as success
		let publishedMediaId: string | undefined;
		let permalink: string | null = null;

		if (containerAt && mayHaveBeenPublished) {
			const recent = await client.recentMedia(
				account.igUserId,
				10,
				accessToken,
			);
			// Media already claimed by other posts never counts as ours.
			const claimedIds = new Set(
				(
					await db().post.findMany({
						where: {
							igMediaId: { in: recent.data.map((m) => m.id) },
							id: { not: postId },
						},
						select: { igMediaId: true },
					})
				).map((p) => p.igMediaId),
			);
			for (const mediaItem of recent.data) {
				if (claimedIds.has(mediaItem.id)) continue;
				const mediaDate = new Date(mediaItem.timestamp);
				if (
					mediaDate.getTime() >= containerAt.getTime() - 1000 &&
					(containerPublished ||
						(mediaItem.caption ?? "").trim() === renderedCaption.trim())
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
		if (err instanceof GraphError && err.isRateLimit) {
			await deferPost(new Date(nowFn().getTime() + 60 * 60 * 1000), errorMsg);
			return;
		}
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
