/**
 * Node-only part of instrumentation.ts (kept separate so the Edge bundle
 * never sees process.exit). Starts the pg-boss worker when JOBS_ENABLED=true:
 * only the jester-worker Deployment sets it (docs/jester.md).
 */
export async function registerNode() {
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
