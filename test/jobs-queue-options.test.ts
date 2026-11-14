import { afterEach, expect, it, vi } from "vitest";

const ctor = vi.fn();
vi.mock("pg-boss", () => ({
	PgBoss: class {
		constructor(opts: unknown) {
			ctor(opts);
		}
		on() {}
		async start() {}
		async stop() {}
	},
}));
vi.mock("server-only", () => ({}));

afterEach(() => {
	ctor.mockClear();
	vi.resetModules();
	vi.unstubAllEnvs();
	delete (globalThis as { boss?: unknown }).boss;
});

async function start(jobsEnabled: string) {
	vi.stubEnv("JOBS_ENABLED", jobsEnabled);
	const { resetEnvCache } = await import("@/lib/env");
	resetEnvCache();
	const { getBoss } = await import("@/lib/jobs/queue");
	await getBoss();
	return ctor.mock.calls[0]?.[0];
}

it("web process: no supervise and no cron", async () => {
	expect(await start("false")).toMatchObject({
		supervise: false,
		schedule: false,
	});
});

it("worker process: supervise and cron on", async () => {
	expect(await start("true")).toMatchObject({
		supervise: true,
		schedule: true,
	});
});
