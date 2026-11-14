import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createS3Client, deleteObjects, setS3Client } from "@/lib/s3";

describe("deleteObjects", () => {
	let result: { Errors?: { Key: string; Code: string }[] };
	const batches: number[] = [];

	beforeEach(() => {
		result = {};
		batches.length = 0;
		const client = createS3Client({
			AWS_REGION: "eu-central-1",
			AWS_ACCESS_KEY_ID: "AKIAFAKE",
			AWS_SECRET_ACCESS_KEY: "fake",
			S3_ENDPOINT: undefined,
		});
		// biome-ignore lint/suspicious/noExplicitAny: dispatching on the command
		client.send = (async (command: any) => {
			if (command instanceof DeleteObjectsCommand) {
				batches.push(command.input.Delete?.Objects?.length ?? 0);
				return result;
			}
			throw new Error("unexpected command");
		}) as S3Client["send"];
		setS3Client(client);
	});

	afterEach(() => setS3Client(undefined));

	it("succeeds when no per-key errors are returned", async () => {
		await expect(deleteObjects(["a", "b"])).resolves.toBeUndefined();
	});

	it("throws naming the failed keys when the response has Errors", async () => {
		result = { Errors: [{ Key: "b", Code: "AccessDenied" }] };
		await expect(deleteObjects(["a", "b"])).rejects.toThrow(
			/b \(AccessDenied\)/,
		);
	});

	it("batches by 1000", async () => {
		await deleteObjects(Array.from({ length: 2001 }, (_, i) => `k${i}`));
		expect(batches).toEqual([1000, 1000, 1]);
	});
});
