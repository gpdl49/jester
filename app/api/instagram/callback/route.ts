import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { badRequest } from "@/lib/http/errors";
import { parseQuery, withAuth } from "@/lib/http/handler";
import { oauthCallbackQuerySchema } from "@/lib/instagram/schema";
import { handleOAuthCallback } from "@/lib/instagram/service";

function parseCookie(
	cookieHeader: string | null,
	name: string,
): string | undefined {
	if (!cookieHeader) return undefined;
	const match = cookieHeader
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${name}=`));
	return match ? match.slice(name.length + 1) : undefined;
}

const COOKIE_ATTRS = "Path=/api/instagram; HttpOnly; SameSite=Lax";

export const GET = withAuth(async (request, _context, user) => {
	requireAdmin(user);
	const query = parseQuery(request, oauthCallbackQuerySchema);
	const secure = env().PUBLIC_URL.startsWith("https://") ? "; Secure" : "";
	const clearCookie = `ig_oauth_state=; ${COOKIE_ATTRS}${secure}; Max-Age=0`;

	// The user declined (or Instagram refused) on the authorize screen.
	if (query.error) {
		return new Response(null, {
			status: 302,
			headers: new Headers([
				["Location", `${env().PUBLIC_URL}/settings?instagram=denied`],
				["Set-Cookie", clearCookie],
			]),
		});
	}
	if (!query.code || !query.state) {
		throw badRequest("Missing code or state");
	}
	const cookieState = parseCookie(
		request.headers.get("cookie"),
		"ig_oauth_state",
	);

	const result = await handleOAuthCallback({
		code: query.code,
		state: query.state,
		cookieState,
		actorId: user.id,
	});

	const e = env();
	const outcome =
		result.accounts.length === 0
			? "no_accounts"
			: result.needsChoice
				? "choose"
				: "connected";
	const redirectUrl = `${e.PUBLIC_URL}/settings?instagram=${outcome}`;

	const headers = new Headers();
	headers.set("Location", redirectUrl);
	// Clear the cookie
	headers.append("Set-Cookie", clearCookie);

	return new Response(null, {
		status: 302,
		headers,
	});
});
