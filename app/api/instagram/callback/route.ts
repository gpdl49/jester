import { env } from "@/lib/env";
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

export const GET = withAuth(async (request, _context, user) => {
	const query = parseQuery(request, oauthCallbackQuerySchema);
	const cookieState = parseCookie(
		request.headers.get("cookie"),
		"ig_oauth_state",
	);

	await handleOAuthCallback({
		code: query.code,
		state: query.state,
		cookieState,
		actorId: user.id,
	});

	const e = env();
	const redirectUrl = `${e.PUBLIC_URL}/settings?instagram=connected`;

	const headers = new Headers();
	headers.set("Location", redirectUrl);
	// Clear the cookie
	headers.append(
		"Set-Cookie",
		"ig_oauth_state=; Path=/api/instagram; HttpOnly; SameSite=Lax; Max-Age=0",
	);

	return new Response(null, {
		status: 302,
		headers,
	});
});
