import crypto from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { withAuth } from "@/lib/http/handler";
import { checkInstagramFeature } from "@/lib/instagram/service";

export const GET = withAuth(async (_request, _context, user) => {
	requireAdmin(user);
	checkInstagramFeature();

	const state = crypto.randomBytes(32).toString("hex");
	const e = env();
	const redirectUri = `${e.PUBLIC_URL}/api/instagram/callback`;

	const authUrl = new URL("https://www.instagram.com/oauth/authorize");
	authUrl.searchParams.set("client_id", e.INSTAGRAM_APP_ID as string);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set(
		"scope",
		"instagram_business_basic,instagram_business_content_publish",
	);
	authUrl.searchParams.set("state", state);

	const headers = new Headers();
	headers.set("Location", authUrl.toString());
	headers.append(
		"Set-Cookie",
		`ig_oauth_state=${state}; Path=/api/instagram; HttpOnly; SameSite=Lax; Max-Age=600${
			e.PUBLIC_URL.startsWith("https://") ? "; Secure" : ""
		}`,
	);

	return new Response(null, {
		status: 302,
		headers,
	});
});
