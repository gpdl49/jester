export type ContainerStatusCode =
	| "EXPIRED"
	| "ERROR"
	| "FINISHED"
	| "IN_PROGRESS"
	| "PUBLISHED";

export type GraphErrorPayload = {
	message: string;
	code?: number;
	error_subcode?: number;
	error_user_title?: string;
	error_user_msg?: string;
	fbtrace_id?: string;
};

export class GraphError extends Error {
	readonly code?: number;
	readonly errorSubcode?: number;
	readonly isRateLimit: boolean;
	readonly isTokenExpired: boolean;
	readonly fbtraceId?: string;

	constructor(error: GraphErrorPayload) {
		super(error.message);
		this.name = "GraphError";
		this.code = error.code;
		this.errorSubcode = error.error_subcode;
		this.fbtraceId = error.fbtrace_id;
		this.isTokenExpired = error.code === 190;
		this.isRateLimit =
			error.code === 4 ||
			error.code === 17 ||
			error.code === 32 ||
			error.code === 613 ||
			error.error_subcode === 2207051 ||
			/rate limit|request limit/i.test(error.message);
	}
}

export type GraphClientOptions = {
	version?: string;
	fetch?: typeof fetch;
	defaultToken?: string;
	defaultIgUserId?: string;
};

export type ExchangeCodeParams = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	code: string;
};

export type ExchangeLongLivedParams = {
	clientSecret: string;
	accessToken: string;
};

export type RefreshTokenParams = {
	accessToken: string;
};

export type CreateImageContainerParams = {
	igUserId?: string;
	token?: string;
	imageUrl: string;
	caption?: string;
	altText?: string;
	isCarouselItem?: boolean;
};

export type CreateCarouselContainerParams = {
	igUserId?: string;
	token?: string;
	children: string[];
	caption?: string;
};

export type PublishParams = {
	igUserId?: string;
	token?: string;
	creationId: string;
};

export type RecentMediaItem = {
	id: string;
	caption?: string;
	timestamp: string;
	permalink?: string;
};

export type PublishingLimitResult = {
	used: number;
	total: number;
};

export function createGraphClient(options: GraphClientOptions = {}) {
	const version = options.version ?? "v25.0";
	const customFetch = options.fetch ?? fetch;
	const graphBase = `https://graph.instagram.com/${version}`;
	const oauthBase = "https://api.instagram.com/oauth";

	function redact(msg: string, token?: string): string {
		if (!token) return msg;
		return msg.replaceAll(token, "[REDACTED]");
	}

	async function request<T>(
		url: string,
		init: RequestInit,
		token?: string,
	): Promise<T> {
		let res: Response;
		try {
			res = await customFetch(url, init);
		} catch (err) {
			const message = redact(
				err instanceof Error ? err.message : String(err),
				token,
			);
			throw new GraphError({ message });
		}

		let data: unknown;
		try {
			data = await res.json();
		} catch {
			if (!res.ok) {
				throw new GraphError({
					message: `HTTP ${res.status}: ${res.statusText}`,
				});
			}
			return {} as T;
		}

		if (data && typeof data === "object" && "error" in data) {
			const errPayload = (data as { error: GraphErrorPayload }).error;
			throw new GraphError({
				...errPayload,
				message: redact(
					errPayload.message || "Instagram Graph API error",
					token,
				),
			});
		}

		if (!res.ok) {
			throw new GraphError({
				message: `HTTP ${res.status}: ${res.statusText}`,
			});
		}

		return data as T;
	}

	function resolveToken(token?: string): string {
		const t = token ?? options.defaultToken;
		if (!t) {
			throw new Error("Instagram access token is required");
		}
		return t;
	}

	function resolveIgUserId(igUserId?: string): string {
		const uid = igUserId ?? options.defaultIgUserId;
		if (!uid) {
			throw new Error("Instagram user ID is required");
		}
		return uid;
	}

	return {
		/**
		 * Exchange an OAuth authorization code for a short-lived access token.
		 * POST https://api.instagram.com/oauth/access_token
		 */
		async exchangeCode(
			params: ExchangeCodeParams,
		): Promise<{ accessToken: string; userId: string }> {
			const body = new URLSearchParams({
				client_id: params.clientId,
				client_secret: params.clientSecret,
				grant_type: "authorization_code",
				redirect_uri: params.redirectUri,
				code: params.code,
			});

			const data = await request<{
				access_token: string;
				user_id: string | number;
			}>(
				`${oauthBase}/access_token`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: body.toString(),
				},
				params.clientSecret,
			);

			return {
				accessToken: data.access_token,
				userId: String(data.user_id),
			};
		},

		/**
		 * Exchange a short-lived token for a long-lived (60 days) token.
		 * GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token
		 */
		async exchangeLongLived(
			params: ExchangeLongLivedParams,
		): Promise<{ accessToken: string; tokenType: string; expiresIn: number }> {
			const url = new URL("https://graph.instagram.com/access_token");
			url.searchParams.set("grant_type", "ig_exchange_token");
			url.searchParams.set("client_secret", params.clientSecret);
			url.searchParams.set("access_token", params.accessToken);

			const data = await request<{
				access_token: string;
				token_type: string;
				expires_in: number;
			}>(url.toString(), { method: "GET" }, params.accessToken);

			return {
				accessToken: data.access_token,
				tokenType: data.token_type,
				expiresIn: data.expires_in,
			};
		},

		/**
		 * Refresh a long-lived access token before it expires.
		 * GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
		 */
		async refreshToken(
			params: RefreshTokenParams,
		): Promise<{ accessToken: string; tokenType: string; expiresIn: number }> {
			const url = new URL("https://graph.instagram.com/refresh_access_token");
			url.searchParams.set("grant_type", "ig_refresh_token");
			url.searchParams.set("access_token", params.accessToken);

			const data = await request<{
				access_token: string;
				token_type: string;
				expires_in: number;
			}>(url.toString(), { method: "GET" }, params.accessToken);

			return {
				accessToken: data.access_token,
				tokenType: data.token_type,
				expiresIn: data.expires_in,
			};
		},

		/**
		 * Retrieve authenticated user information (user_id, username).
		 * GET /me?fields=user_id,username
		 */
		async me(
			token?: string,
		): Promise<{ id: string; userId: string; username: string }> {
			const t = resolveToken(token);
			const url = `${graphBase}/me?fields=user_id,username`;
			const data = await request<{
				id: string;
				user_id?: string;
				username: string;
			}>(
				url,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${t}` },
				},
				t,
			);

			return {
				id: data.id,
				userId: data.user_id ?? data.id,
				username: data.username,
			};
		},

		/**
		 * Create an item media container (single image or carousel item).
		 * POST /{ig-user-id}/media
		 */
		async createImageContainer(
			params: CreateImageContainerParams,
		): Promise<{ id: string }> {
			const token = resolveToken(params.token);
			const igUserId = resolveIgUserId(params.igUserId);

			const body = new URLSearchParams({
				image_url: params.imageUrl,
			});
			if (params.caption) {
				body.set("caption", params.caption);
			}
			if (params.altText) {
				body.set("alt_text", params.altText);
				body.set("alt_text_user_provided", params.altText);
			}
			if (params.isCarouselItem) {
				body.set("is_carousel_item", "true");
			}

			const data = await request<{ id: string }>(
				`${graphBase}/${igUserId}/media`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: body.toString(),
				},
				token,
			);

			return { id: data.id };
		},

		/**
		 * Create a carousel parent container.
		 * POST /{ig-user-id}/media {media_type: "CAROUSEL", children, caption}
		 */
		async createCarouselContainer(
			params: CreateCarouselContainerParams,
		): Promise<{ id: string }> {
			const token = resolveToken(params.token);
			const igUserId = resolveIgUserId(params.igUserId);

			const body = new URLSearchParams({
				media_type: "CAROUSEL",
				children: params.children.join(","),
			});
			if (params.caption) {
				body.set("caption", params.caption);
			}

			const data = await request<{ id: string }>(
				`${graphBase}/${igUserId}/media`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: body.toString(),
				},
				token,
			);

			return { id: data.id };
		},

		/**
		 * Check status of an item or carousel container.
		 * GET /{container-id}?fields=status_code
		 */
		async containerStatus(
			id: string,
			token?: string,
		): Promise<{ id: string; status_code: ContainerStatusCode }> {
			const t = resolveToken(token);
			const data = await request<{
				id: string;
				status_code: ContainerStatusCode;
			}>(
				`${graphBase}/${id}?fields=status_code`,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${t}` },
				},
				t,
			);

			return { id: data.id, status_code: data.status_code };
		},

		/**
		 * Publish a ready container.
		 * POST /{ig-user-id}/media_publish {creation_id}
		 */
		async publish(
			creationIdOrParams: string | PublishParams,
			options?: { igUserId?: string; token?: string },
		): Promise<{ id: string }> {
			let creationId: string;
			let igUserId: string;
			let token: string;

			if (typeof creationIdOrParams === "string") {
				creationId = creationIdOrParams;
				igUserId = resolveIgUserId(options?.igUserId);
				token = resolveToken(options?.token);
			} else {
				creationId = creationIdOrParams.creationId;
				igUserId = resolveIgUserId(
					creationIdOrParams.igUserId ?? options?.igUserId,
				);
				token = resolveToken(creationIdOrParams.token ?? options?.token);
			}

			const body = new URLSearchParams({
				creation_id: creationId,
			});

			const data = await request<{ id: string }>(
				`${graphBase}/${igUserId}/media_publish`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: body.toString(),
				},
				token,
			);

			return { id: data.id };
		},

		/**
		 * Fetch media details.
		 * GET /{media-id}?fields=...
		 */
		async media(
			id: string,
			fields: string[],
			token?: string,
		): Promise<Record<string, unknown>> {
			const t = resolveToken(token);
			const url = `${graphBase}/${id}?fields=${fields.join(",")}`;
			return request<Record<string, unknown>>(
				url,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${t}` },
				},
				t,
			);
		},

		/**
		 * Fetch recent media published by user (id, caption, timestamp, permalink).
		 * GET /{ig-user-id}/media?fields=id,caption,timestamp,permalink&limit=...
		 */
		async recentMedia(
			igUserId?: string,
			limit = 25,
			token?: string,
		): Promise<{ data: RecentMediaItem[] }> {
			const uid = resolveIgUserId(igUserId);
			const t = resolveToken(token);
			const url = `${graphBase}/${uid}/media?fields=id,caption,timestamp,permalink&limit=${limit}`;

			const data = await request<{ data?: RecentMediaItem[] }>(
				url,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${t}` },
				},
				t,
			);

			return { data: data.data ?? [] };
		},

		/**
		 * Retrieve content publishing rate limit quota.
		 * GET /{ig-user-id}/content_publishing_limit?fields=config,quota_usage
		 */
		async publishingLimit(
			igUserId?: string,
			token?: string,
		): Promise<PublishingLimitResult> {
			const uid = resolveIgUserId(igUserId);
			const t = resolveToken(token);
			const url = `${graphBase}/${uid}/content_publishing_limit?fields=config,quota_usage`;

			const res = await request<{
				data?: Array<{
					quota_usage?: number;
					config?: { quota_total?: number; quota_duration?: number };
				}>;
				quota_usage?: number;
				used?: number;
				total?: number;
				config?: { quota_total?: number };
			}>(
				url,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${t}` },
				},
				t,
			);

			if (Array.isArray(res.data) && res.data.length > 0) {
				const entry = res.data[0];
				if (entry) {
					return {
						used: entry.quota_usage ?? 0,
						total: entry.config?.quota_total ?? 100,
					};
				}
			}

			return {
				used: res.used ?? res.quota_usage ?? 0,
				total: res.total ?? res.config?.quota_total ?? 100,
			};
		},
	};
}

export type GraphClient = ReturnType<typeof createGraphClient>;
