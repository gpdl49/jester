import { afterAll, expect, it } from "vitest";
import { instagramPublish } from "@/lib/jobs/definitions/instagram-publish";
import { enqueue, stopBoss } from "@/lib/jobs/queue";
import { describeWithDb } from "@/test/helpers/db";

describeWithDb("instagram.publish queue policy", () => {
	afterAll(async () => {
		await stopBoss();
	});

	it("keeps one waiting job per post, but lets different posts queue together", async () => {
		const a = crypto.randomUUID();
		const b = crypto.randomUUID();

		const first = await enqueue(
			instagramPublish,
			{ postId: a },
			{ singletonKey: a },
		);
		// The scheduler tick enqueues a due post every minute: no pile-up
		const duplicate = await enqueue(
			instagramPublish,
			{ postId: a },
			{ singletonKey: a },
		);
		const other = await enqueue(
			instagramPublish,
			{ postId: b },
			{ singletonKey: b },
		);

		expect(first).toBeTruthy();
		expect(duplicate).toBeNull();
		expect(other).toBeTruthy();
	});
});
