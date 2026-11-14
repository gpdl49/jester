/**
 * Runs once when the Next.js server starts. The worker only runs in the
 * Node.js runtime; see instrumentation-node.ts.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerNode } = await import("./instrumentation-node");
		await registerNode();
	}
}
