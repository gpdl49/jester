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
	/** Error 190: the token is invalid, expired or revoked; reconnect. */
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

export const DEFAULT_GRAPH_VERSION = "v27.0";

export type GraphClientOptions = {
	version?: string;
	fetch?: typeof fetch;
	defaultToken?: string;
	defaultIgUserId?: string;
};

export type ExchangeCodeParams = {
	clientId: string;
	clientSecret: string;
	code: string;
};

export type DebugTokenParams = {
	appId: string;
	appSecret: string;
	inputToken: string;
};

export type DebugTokenResult = {
	isValid: boolean;
	/** null when the token never expires (`expires_at` of 0 or absent) */
	expiresAt: Date | null;
	scopes: string[];
};

export type AssignedInstagramAccount = { id: string; username: string };

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

/**
 * Instagram API with Unified Login: every call goes to graph.facebook.com
 * with a Business Integration System User access token and the Instagram
 * professional account id in the path.
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
 */
export function createGraphClient(options: GraphClientOptions = {}) {
	// INSTAGRAM_GRAPH_VERSION (docs/jester.md) unless a caller pins one
	const version =
		options.version ??
		process.env.INSTAGRAM_GRAPH_VERSION ??
		DEFAULT_GRAPH_VERSION;
	const customFetch = options.fetch ?? fetch;
	const graphBase = `https://graph.facebook.com/${version}`;

	function redact(msg: string, secrets: Array<string | undefined>): string {
		let out = msg;
		for (const s of secrets) {
			if (s) out = out.replaceAll(s, "[REDACTED]");
		}
		return out;
	}

	async function request<T>(
		url: string,
		init: RequestInit,
		secrets: Array<string | undefined>,
	): Promise<T> {
		let res: Response;
		try {
			res = await customFetch(url, init);
		} catch (err) {
			throw new GraphError({
				message: redact(
					err instanceof Error ? err.message : String(err),
					secrets,
				),
			});
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
					secrets,
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

	function get<T>(
		path: string,
		params: Record<string, string>,
		token: string,
		secrets: Array<string | undefined> = [token],
	): Promise<T> {
		const url = new URL(`${graphBase}/${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		url.searchParams.set("access_token", token);
		return request<T>(url.toString(), { method: "GET" }, secrets);
	}

	function post<T>(
		path: string,
		params: Record<string, string>,
		token: string,
	): Promise<T> {
		const body = new URLSearchParams(params);
		body.set("access_token", token);
		return request<T>(
			`${graphBase}/${path}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: body.toString(),
			},
			[token],
		);
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
		 * Exchange the login `code` for a Business Integration System User
		 * access token. GET /oauth/access_token with the Meta app id and secret.
		 */
		async exchangeCode(
			params: ExchangeCodeParams,
		): Promise<{ accessToken: string; expiresIn: number | null }> {
			const url = new URL(`${graphBase}/oauth/access_token`);
			url.searchParams.set("client_id", params.clientId);
			url.searchParams.set("client_secret", params.clientSecret);
			url.searchParams.set("code", params.code);

			const data = await request<{
				access_token: string;
				expires_in?: number;
			}>(url.toString(), { method: "GET" }, [params.clientSecret, params.code]);

			return {
				accessToken: data.access_token,
				expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
			};
		},

		/**
		 * Inspect a token. GET /debug_token with an app access token
		 * (`app-id|app-secret`). `expires_at` 0 means the token never expires.
		 */
		async debugToken(params: DebugTokenParams): Promise<DebugTokenResult> {
			const appToken = `${params.appId}|${params.appSecret}`;
			const data = await get<{
				data?: {
					is_valid?: boolean;
					expires_at?: number;
					scopes?: string[];
				};
			}>("debug_token", { input_token: params.inputToken }, appToken, [
				appToken,
				params.appSecret,
				params.inputToken,
			]);
			const d = data.data ?? {};
			return {
				isValid: d.is_valid === true,
				expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
				scopes: d.scopes ?? [],
			};
		},

		/**
		 * List the Instagram professional accounts the client shared with the
		 * app. GET /me/assigned_instagram_accounts (needs `instagram_basic`).
		 */
		async assignedInstagramAccounts(
			token?: string,
		): Promise<AssignedInstagramAccount[]> {
			const t = resolveToken(token);
			const accounts: AssignedInstagramAccount[] = [];
			let after: string | undefined;
			// A few pages at most; a client shares a handful of accounts.
			for (let page = 0; page < 10; page++) {
				const params: Record<string, string> = { fields: "id,username" };
				if (after) params.after = after;
				const res = await get<{
					data?: Array<{ id: string; username?: string }>;
					paging?: { cursors?: { after?: string }; next?: string };
				}>("me/assigned_instagram_accounts", params, t);
				for (const a of res.data ?? []) {
					accounts.push({ id: String(a.id), username: a.username ?? a.id });
				}
				after = res.paging?.next ? res.paging.cursors?.after : undefined;
				if (!after) break;
			}
			return accounts;
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

			const body: Record<string, string> = { image_url: params.imageUrl };
			if (params.caption) body.caption = params.caption;
			if (params.altText) body.alt_text = params.altText;
			if (params.isCarouselItem) body.is_carousel_item = "true";

			const data = await post<{ id: string }>(`${igUserId}/media`, body, token);
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

			const body: Record<string, string> = {
				media_type: "CAROUSEL",
				children: params.children.join(","),
			};
			if (params.caption) body.caption = params.caption;

			const data = await post<{ id: string }>(`${igUserId}/media`, body, token);
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
			const data = await get<{
				id: string;
				status_code: ContainerStatusCode;
			}>(id, { fields: "status_code" }, t);
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

			const data = await post<{ id: string }>(
				`${igUserId}/media_publish`,
				{ creation_id: creationId },
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
			return get<Record<string, unknown>>(id, { fields: fields.join(",") }, t);
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
			const data = await get<{ data?: RecentMediaItem[] }>(
				`${uid}/media`,
				{ fields: "id,caption,timestamp,permalink", limit: String(limit) },
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
			const res = await get<{
				data?: Array<{
					quota_usage?: number;
					config?: { quota_total?: number; quota_duration?: number };
				}>;
				quota_usage?: number;
				used?: number;
				total?: number;
				config?: { quota_total?: number };
			}>(
				`${uid}/content_publishing_limit`,
				{ fields: "config,quota_usage" },
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
