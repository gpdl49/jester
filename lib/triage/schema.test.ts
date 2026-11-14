import { describe, expect, it } from "vitest";
import {
	triageAcceptAboveSchema,
	triageDecisionsSchema,
	triageQuerySchema,
	triageResultSchema,
} from "./schema";

describe("triageResultSchema", () => {
	it("parses valid triage results and preserves valid probability", () => {
		const parsed = triageResultSchema.parse({
			memeProbability: 0.85,
			kind: "meme",
			reason: "Classic image macro with caption",
		});
		expect(parsed).toEqual({
			memeProbability: 0.85,
			kind: "meme",
			reason: "Classic image macro with caption",
		});
	});

	it("clamps probability values below 0 or above 1", () => {
		const high = triageResultSchema.parse({
			memeProbability: 1.25,
			kind: "reaction_image",
			reason: "Shocked face reaction",
		});
		expect(high.memeProbability).toBe(1);

		const low = triageResultSchema.parse({
			memeProbability: -0.2,
			kind: "photo",
			reason: "Family vacation photo",
		});
		expect(low.memeProbability).toBe(0);
	});

	it("rejects unknown kinds or empty reasons", () => {
		expect(() =>
			triageResultSchema.parse({
				memeProbability: 0.5,
				kind: "unknown_kind",
				reason: "Some reason",
			}),
		).toThrow();

		expect(() =>
			triageResultSchema.parse({
				memeProbability: 0.5,
				kind: "meme",
				reason: "   ",
			}),
		).toThrow();
	});
});

describe("triageQuerySchema", () => {
	it("provides sensible defaults", () => {
		const query = triageQuerySchema.parse({});
		expect(query.status).toBe("scored");
		expect(query.limit).toBe(50);
		expect(query.minProbability).toBeUndefined();
		expect(query.cursor).toBeUndefined();
	});

	it("coerces query string numbers", () => {
		const query = triageQuerySchema.parse({
			status: "pending",
			minProbability: "0.75",
			limit: "25",
			cursor: "cursor-uuid",
		});
		expect(query.status).toBe("pending");
		expect(query.minProbability).toBe(0.75);
		expect(query.limit).toBe(25);
		expect(query.cursor).toBe("cursor-uuid");
	});
});

describe("triageDecisionsSchema", () => {
	it("validates up to 200 decisions", () => {
		const valid = triageDecisionsSchema.parse({
			decisions: [
				{
					immichAssetId: "01932cf3-4c91-7f99-a991-884c78491bb4",
					decision: "accept",
				},
				{
					immichAssetId: "01932cf3-4c91-7f99-a991-884c78491bb5",
					decision: "reject",
				},
			],
		});
		expect(valid.decisions).toHaveLength(2);
	});

	it("rejects empty decisions array", () => {
		expect(() =>
			triageDecisionsSchema.parse({
				decisions: [],
			}),
		).toThrow();
	});
});

describe("triageAcceptAboveSchema", () => {
	it("validates minProbability between 0 and 1", () => {
		expect(triageAcceptAboveSchema.parse({ minProbability: 0.8 })).toEqual({
			minProbability: 0.8,
		});
		expect(() =>
			triageAcceptAboveSchema.parse({ minProbability: 1.5 }),
		).toThrow();
	});
});
