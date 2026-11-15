import { env } from "@/lib/env";
import { PermanentJobError } from "@/lib/jobs/define";
import { getBoss } from "@/lib/jobs/queue";
import { jobDefinitions } from "@/lib/jobs/registry";

/**
 * Starts the worker: creates each registered queue (idempotent), installs
 * cron schedules, and works the queues. Called from instrumentation.ts when
 * JOBS_ENABLED=true (the jester-worker Deployment).
 */
export async function startWorker(): Promise<void> {
	const boss = await getBoss();
	const interval = env().IMMICH_SYNC_INTERVAL_MINUTES;
	for (const definition of jobDefinitions) {
		await boss.createQueue(definition.name, definition.queue);
		if (definition.queue) {
			// The policy is fixed at creation; everything else can change.
			const { policy: _policy, ...changeable } = definition.queue;
			await boss.updateQueue(definition.name, changeable);
		}
		if (definition.cron) {
			const expression = definition.cron.expression.replace(
				"{IMMICH_SYNC_INTERVAL_MINUTES}",
				String(interval),
			);
			await boss.schedule(
				definition.name,
				expression,
				definition.cron.data as object,
			);
		}
		const concurrency = definition.concurrency ?? 1;
		for (let i = 0; i < concurrency; i++) {
			await boss.work(definition.name, { batchSize: 1 }, async ([job]) => {
				if (!job) {
					return;
				}
				const data = definition.schema.parse(job.data);
				try {
					await definition.handler(data, job);
				} catch (err) {
					if (err instanceof PermanentJobError) {
						// Recorded by the handler; finishing the job stops retries.
						console.warn(`[jobs] ${definition.name} ${job.id}: ${err.message}`);
						return;
					}
					throw err;
				}
			});
		}
	}
	console.info(
		`[jobs] worker started: ${jobDefinitions.map((d) => d.name).join(", ")}`,
	);
}
