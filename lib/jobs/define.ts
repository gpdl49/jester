import type { Job, Queue } from "pg-boss";
import type { z } from "zod";

/**
 * A background job type. Payloads are validated with `schema` both when
 * enqueued and when worked, so a stale or hand-inserted job fails loudly
 * instead of running with bad data.
 */
export type JobDefinition<S extends z.ZodType = z.ZodType> = {
	/** pg-boss queue name: `<area>.<action>` (docs/jester.md "Jobs"). */
	name: string;
	schema: S;
	handler: (data: z.output<S>, job: Job<unknown>) => Promise<void>;
	/** Queue settings (retries, expiry...), applied when the worker starts. */
	queue?: Omit<Queue, "name">;
	/** Parallel jobs of this type per worker process (default 1). */
	concurrency?: number;
	/**
	 * Cron schedule (pg-boss `schedule`, UTC) with the payload to send. The
	 * placeholder `{IMMICH_SYNC_INTERVAL_MINUTES}` is replaced from the env.
	 */
	cron?: { expression: string; data: z.input<S> };
};

export function defineJob<S extends z.ZodType>(
	definition: JobDefinition<S>,
): JobDefinition<S> {
	return definition;
}

export type JobData<J extends JobDefinition> = z.input<J["schema"]>;

/** Thrown by a handler to finish without retrying (the error is recorded). */
export class PermanentJobError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PermanentJobError";
	}
}
