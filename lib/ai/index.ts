import "server-only";
import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { budgetExceeded, featureDisabled } from "@/lib/http/errors";
import { getSetting } from "@/lib/settings";
import {
	type StructuredRequest,
	type StructuredResponse,
	structuredCompletion,
} from "./openrouter";

/**
 * Every OpenRouter call goes through `aiCall`: it refuses when AI is off or
 * paused or the daily budget (UTC day) is spent, and records the call's cost
 * in ai_usage. Jobs that hit the budget should re-queue themselves for the
 * next UTC day (see `nextBudgetReset`) rather than fail.
 */

export type AiKind = "triage" | "meme" | "attribution";

export class BudgetExceededError extends Error {
	constructor(
		readonly spentUsd: number,
		readonly budgetUsd: number,
	) {
		super(`Daily AI budget spent: $${spentUsd.toFixed(4)} of $${budgetUsd}`);
		this.name = "BudgetExceededError";
	}
}

export const startOfUtcDay = (now = new Date()) =>
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** When a job deferred by the budget should run again. */
export const nextBudgetReset = (now = new Date()) =>
	new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000 + 60_000);

export async function spentSince(since: Date): Promise<number> {
	const result = await db().aiUsage.aggregate({
		_sum: { costUsd: true },
		where: { at: { gte: since } },
	});
	return result._sum.costUsd ?? 0;
}

/** Throws BudgetExceededError when today's spend has reached the budget. */
export async function assertBudget(now = new Date()): Promise<void> {
	const budget = await getSetting("ai.dailyBudgetUsd");
	const spent = await spentSince(startOfUtcDay(now));
	if (spent >= budget) {
		throw new BudgetExceededError(spent, budget);
	}
}

export type AiCallRequest = Omit<StructuredRequest, "apiKey"> & {
	kind: AiKind;
	/** What the call was for (meme or asset id), stored on the usage row. */
	refId?: string;
};

/** For API routes: map AI availability to the contract's 503 / 429. */
export async function assertAiAvailable(): Promise<void> {
	if (!features().ai) {
		throw featureDisabled("OpenRouter");
	}
	if (await getSetting("ai.paused")) {
		throw featureDisabled("AI (paused in settings)");
	}
	try {
		await assertBudget();
	} catch (err) {
		if (err instanceof BudgetExceededError) {
			throw budgetExceeded(err.message);
		}
		throw err;
	}
}

export async function aiCall(
	request: AiCallRequest,
): Promise<StructuredResponse> {
	const apiKey = env().OPENROUTER_API_KEY;
	if (!apiKey) {
		throw featureDisabled("OpenRouter");
	}
	if (await getSetting("ai.paused")) {
		throw featureDisabled("AI (paused in settings)");
	}
	await assertBudget();
	const { kind, refId, ...rest } = request;
	const response = await structuredCompletion({ ...rest, apiKey });
	await db().aiUsage.create({
		data: {
			kind,
			model: response.model,
			promptTokens: response.usage?.prompt_tokens ?? 0,
			completionTokens: response.usage?.completion_tokens ?? 0,
			costUsd: response.usage?.cost ?? 0,
			refId: refId ?? null,
		},
	});
	return response;
}

export type { ChatMessage, StructuredResponse } from "./openrouter";
export { OpenRouterError } from "./openrouter";
