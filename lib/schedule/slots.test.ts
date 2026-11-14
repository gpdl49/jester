import { describe, expect, it } from "vitest";
import {
	getNextSlotInstants,
	getSlotInstantsBetween,
	resolveSlotInstant,
} from "./slots";

describe("schedule slots computation", () => {
	const timezone = "America/New_York";

	it("computes next slot instants chronologically", () => {
		const slots = [
			{ id: "slot-mon-10", weekday: 1, time: "10:00", enabled: true },
			{ id: "slot-mon-18", weekday: 1, time: "18:00", enabled: true },
			{ id: "slot-wed-12", weekday: 3, time: "12:00", enabled: true },
			{ id: "slot-fri-15", weekday: 5, time: "15:00", enabled: false }, // disabled
		];

		// Sunday 2026-03-01 12:00 UTC (07:00 EST)
		const now = new Date("2026-03-01T12:00:00Z");
		const instants = getNextSlotInstants(slots, now, 3, timezone);

		expect(instants).toHaveLength(3);
		expect(instants[0]?.slot.id).toBe("slot-mon-10");
		// Mon Mar 2 10:00 EST -> 15:00 UTC
		expect(instants[0]?.at.toISOString()).toBe("2026-03-02T15:00:00.000Z");

		expect(instants[1]?.slot.id).toBe("slot-mon-18");
		// Mon Mar 2 18:00 EST -> 23:00 UTC
		expect(instants[1]?.at.toISOString()).toBe("2026-03-02T23:00:00.000Z");

		expect(instants[2]?.slot.id).toBe("slot-wed-12");
		// Wed Mar 4 12:00 EST -> 17:00 UTC
		expect(instants[2]?.at.toISOString()).toBe("2026-03-04T17:00:00.000Z");
	});

	it("handles spring-forward DST gap by moving forward to the next valid minute", () => {
		// In America/New_York, DST starts on Sunday 2026-03-08.
		// Clocks jump from 01:59:59 to 03:00:00.
		// 02:30 does not exist.
		const resolved = resolveSlotInstant(2026, 2, 8, 2, 30, timezone);

		// 03:00 EDT is UTC 07:00
		expect(resolved.toISOString()).toBe("2026-03-08T07:00:00.000Z");

		const slots = [
			{ id: "slot-sun-gap", weekday: 0, time: "02:30", enabled: true },
		];
		const now = new Date("2026-03-08T00:00:00Z");
		const next = getNextSlotInstants(slots, now, 1, timezone);

		expect(next).toHaveLength(1);
		expect(next[0]?.at.toISOString()).toBe("2026-03-08T07:00:00.000Z");
	});

	it("handles fall-back DST ambiguity by picking the first occurrence", () => {
		// In America/New_York, DST ends on Sunday 2026-11-01.
		// Clocks fall back from 02:00:00 EDT (06:00 UTC) to 01:00:00 EST (06:00 UTC).
		// 01:30 occurs first at 05:30 UTC (-4 EDT) and second at 06:30 UTC (-5 EST).
		const resolved = resolveSlotInstant(2026, 10, 1, 1, 30, timezone);

		// First occurrence should be 05:30 UTC (EDT)
		expect(resolved.toISOString()).toBe("2026-11-01T05:30:00.000Z");

		const slots = [
			{ id: "slot-sun-fallback", weekday: 0, time: "01:30", enabled: true },
		];
		const now = new Date("2026-11-01T00:00:00Z");
		const next = getNextSlotInstants(slots, now, 1, timezone);

		expect(next).toHaveLength(1);
		expect(next[0]?.at.toISOString()).toBe("2026-11-01T05:30:00.000Z");
	});

	it("computes slot instants between two dates", () => {
		const slots = [
			{ id: "slot-tue", weekday: 2, time: "09:00", enabled: true },
			{ id: "slot-thu", weekday: 4, time: "09:00", enabled: true },
		];

		const from = new Date("2026-03-01T00:00:00Z");
		const to = new Date("2026-03-08T00:00:00Z");
		const instants = getSlotInstantsBetween(slots, from, to, timezone);

		// Tuesday Mar 3, Thursday Mar 5
		expect(instants).toHaveLength(2);
		expect(instants[0]?.slot.id).toBe("slot-tue");
		expect(instants[1]?.slot.id).toBe("slot-thu");
	});
});
