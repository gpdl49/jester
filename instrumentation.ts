/**
 * Runs once when the Next.js server starts. Starts the pg-boss worker in this
 * process (docs/memes.md: only the memes-worker Deployment sets JOBS_ENABLED=true).
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") {
		return;
	}
	const { env } = await import("@/lib/env");
	// Fail fast on a bad environment instead of on the first request.
	const config = env();
	if (!config.JOBS_ENABLED) {
		return;
	}
	const { startWorker } = await import("@/lib/jobs/worker");
	try {
		await startWorker();
	} catch (err) {
		// A worker pod without a worker is useless but would still pass the
		// health check: exit so Kubernetes restarts it.
		console.error("[jobs] worker failed to start, exiting", err);
		process.exit(1);
	}
}
