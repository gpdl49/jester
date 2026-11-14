import { db, type Prisma } from "@/lib/db";

/**
 * The audit log (docs/memes.md "AuditEvent"). Every slice records
 * user-visible decisions and destructive actions through `audit()`:
 * `triage.accept`, `triage.reject`, `meme.approve`, `meme.reject`,
 * `meme.delete`, `immich.delete`, `attribution.confirm`, `post.queue`,
 * `post.publish`, `post.fail`, `instagram.connect`, `settings.update`, …
 */
export type AuditInput = {
	/** users.id, or null for the system (jobs). */
	actorId: string | null;
	action: string;
	subjectType: string;
	subjectId?: string | null;
	data?: Record<string, unknown>;
};

export async function audit(
	input: AuditInput,
	client: Pick<Prisma.TransactionClient, "auditEvent"> = db(),
): Promise<void> {
	await client.auditEvent.create({
		data: {
			actorId: input.actorId,
			action: input.action,
			subjectType: input.subjectType,
			subjectId: input.subjectId ?? null,
			data: (input.data ?? {}) as Prisma.InputJsonValue,
		},
	});
}
