import { afterEach, expect, it, vi } from "vitest";

const startWorker = vi.fn();
vi.mock("@/lib/jobs/worker", () => ({ startWorker }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	startWorker.mockReset();
});

async function run(jobs: string) {
	vi.stubEnv("NEXT_RUNTIME", "nodejs");
	vi.stubEnv("JOBS_ENABLED", jobs);
	const { resetEnvCache } = await import("@/lib/env");
	resetEnvCache();
	const { register } = await import("@/instrumentation");
	await register();
}

it("exits non-zero when the worker fails to start", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const exit = vi
		.spyOn(process, "exit")
		.mockImplementation((() => {}) as never);
	startWorker.mockRejectedValue(new Error("boom"));
	await run("true");
	expect(exit).toHaveBeenCalledWith(1);
});

it("does not start a worker or exit in the web process", async () => {
	const exit = vi
		.spyOn(process, "exit")
		.mockImplementation((() => {}) as never);
	await run("false");
	expect(startWorker).not.toHaveBeenCalled();
	expect(exit).not.toHaveBeenCalled();
});
