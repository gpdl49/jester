import { TZDate } from "@date-fns/tz";
import { env } from "@/lib/env";

export type ScheduleSlotInput = {
	id?: string;
	accountId?: string | null;
	weekday: number; // 0-6, 0 = Sunday
	time: string; // HH:MM
	enabled: boolean;
};

export type SlotInstant<S extends ScheduleSlotInput = ScheduleSlotInput> = {
	at: Date; // UTC Date
	slot: S;
};

/**
 * Resolves the slot instant for a given local date and target time.
 * If the local time does not exist (spring-forward gap), it moves forward
 * to the next valid minute.
 * If the local time is ambiguous (fall-back), TZDate defaults to the first occurrence.
 */
export function resolveSlotInstant(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timezone: string,
): Date {
	let curH = hour;
	let curMin = minute;
	let curD = day;
	const curM = month;
	const curY = year;

	// Advance minute by minute if in a spring-forward gap until a valid minute is found.
	while (true) {
		const dt = new TZDate(curY, curM, curD, curH, curMin, 0, timezone);
		if (dt.getHours() === curH && dt.getMinutes() === curMin) {
			return new Date(dt.getTime());
		}
		curMin++;
		if (curMin >= 60) {
			curMin = 0;
			curH++;
			if (curH >= 24) {
				curH = 0;
				curD++;
			}
		}
	}
}

/**
 * Produces the next N slot instants strictly after `now`, ordered by time.
 */
export function getNextSlotInstants<S extends ScheduleSlotInput>(
	slots: S[],
	now: Date,
	count: number,
	timezone: string = env().SCHEDULE_TIMEZONE,
): SlotInstant<S>[] {
	if (count <= 0) return [];
	const enabledSlots = slots.filter((s) => s.enabled);
	if (enabledSlots.length === 0) return [];

	const result: SlotInstant<S>[] = [];
	const nowTime = now.getTime();
	const refTz = new TZDate(now, timezone);
	const startY = refTz.getFullYear();
	const startM = refTz.getMonth();
	const startD = refTz.getDate();

	// Search up to 365 days ahead to fulfill `count`
	for (let dayOffset = 0; dayOffset < 365; dayOffset++) {
		const dayRef = new TZDate(
			startY,
			startM,
			startD + dayOffset,
			12,
			0,
			0,
			timezone,
		);
		const y = dayRef.getFullYear();
		const m = dayRef.getMonth();
		const d = dayRef.getDate();
		const weekday = dayRef.getDay();

		const daySlots = enabledSlots
			.filter((s) => s.weekday === weekday)
			.sort((a, b) => a.time.localeCompare(b.time));

		for (const slot of daySlots) {
			const [hStr, mStr] = slot.time.split(":");
			const targetH = Number.parseInt(hStr ?? "0", 10);
			const targetMin = Number.parseInt(mStr ?? "0", 10);

			const instant = resolveSlotInstant(y, m, d, targetH, targetMin, timezone);

			if (instant.getTime() > nowTime) {
				result.push({ at: instant, slot });
			}
		}

		if (result.length >= count) {
			break;
		}
	}

	result.sort((a, b) => a.at.getTime() - b.at.getTime());
	return result.slice(0, count);
}

/**
 * Produces all slot instants between `from` and `to` (inclusive of `from` and `to`).
 */
export function getSlotInstantsBetween<S extends ScheduleSlotInput>(
	slots: S[],
	from: Date,
	to: Date,
	timezone: string = env().SCHEDULE_TIMEZONE,
): SlotInstant<S>[] {
	const enabledSlots = slots.filter((s) => s.enabled);
	if (enabledSlots.length === 0) return [];

	const fromTime = from.getTime();
	const toTime = to.getTime();
	if (fromTime > toTime) return [];

	const result: SlotInstant<S>[] = [];
	const fromTz = new TZDate(from, timezone);

	const startY = fromTz.getFullYear();
	const startM = fromTz.getMonth();
	const startD = fromTz.getDate();

	// Calculate rough day range
	const msDiff = toTime - fromTime;
	const daysCount = Math.ceil(msDiff / (24 * 3600 * 1000)) + 3;

	for (let dayOffset = 0; dayOffset <= daysCount; dayOffset++) {
		const dayRef = new TZDate(
			startY,
			startM,
			startD + dayOffset,
			12,
			0,
			0,
			timezone,
		);
		const y = dayRef.getFullYear();
		const m = dayRef.getMonth();
		const d = dayRef.getDate();
		const weekday = dayRef.getDay();

		const daySlots = enabledSlots
			.filter((s) => s.weekday === weekday)
			.sort((a, b) => a.time.localeCompare(b.time));

		for (const slot of daySlots) {
			const [hStr, mStr] = slot.time.split(":");
			const targetH = Number.parseInt(hStr ?? "0", 10);
			const targetMin = Number.parseInt(mStr ?? "0", 10);

			const instant = resolveSlotInstant(y, m, d, targetH, targetMin, timezone);
			const instTime = instant.getTime();

			if (instTime >= fromTime && instTime <= toTime) {
				result.push({ at: instant, slot });
			}
		}
	}

	result.sort((a, b) => a.at.getTime() - b.at.getTime());
	return result;
}
