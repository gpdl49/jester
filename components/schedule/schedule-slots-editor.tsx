"use client";

import { Check, Clock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useScheduleSlots, useUpdateScheduleSlots } from "@/lib/client/posts";

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

type SlotState = {
	accountId: string | null;
	weekday: number;
	time: string;
	enabled: boolean;
};

export function ScheduleSlotsEditor() {
	const { data: remoteSlots, isLoading, error } = useScheduleSlots();
	const updateMutation = useUpdateScheduleSlots();

	const [slots, setSlots] = useState<SlotState[]>([]);
	const [newTime, setNewTime] = useState<Record<number, string>>({});
	const [saveSuccess, setSaveSuccess] = useState(false);

	useEffect(() => {
		if (remoteSlots) {
			setSlots(
				remoteSlots.map((s) => ({
					accountId: s.accountId,
					weekday: s.weekday,
					time: s.time,
					enabled: s.enabled,
				})),
			);
		}
	}, [remoteSlots]);

	const handleToggle = (weekday: number, time: string) => {
		setSlots((prev) =>
			prev.map((s) =>
				s.weekday === weekday && s.time === time
					? { ...s, enabled: !s.enabled }
					: s,
			),
		);
		setSaveSuccess(false);
	};

	const handleRemove = (weekday: number, time: string) => {
		setSlots((prev) =>
			prev.filter((s) => !(s.weekday === weekday && s.time === time)),
		);
		setSaveSuccess(false);
	};

	const handleAdd = (weekday: number) => {
		const time = (newTime[weekday] ?? "").trim();
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
			return;
		}

		if (slots.some((s) => s.weekday === weekday && s.time === time)) {
			return;
		}

		setSlots((prev) =>
			[...prev, { accountId: null, weekday, time, enabled: true }].sort(
				(a, b) =>
					a.weekday !== b.weekday
						? a.weekday - b.weekday
						: a.time.localeCompare(b.time),
			),
		);
		setNewTime((prev) => ({ ...prev, [weekday]: "" }));
		setSaveSuccess(false);
	};

	const handleSave = async () => {
		try {
			await updateMutation.mutateAsync(slots);
			setSaveSuccess(true);
			setTimeout(() => setSaveSuccess(false), 3000);
		} catch {
			// Mutation error handled by TanStack Query
		}
	};

	if (isLoading) {
		return (
			<div className="py-6 text-sm text-faint">Loading schedule slots…</div>
		);
	}

	if (error) {
		return (
			<div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
				Failed to load schedule slots.
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-base font-semibold text-fg">Publishing Slots</h3>
					<p className="text-sm text-faint">
						Configure the recurring weekly schedule for queued posts.
					</p>
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={handleSave}
					disabled={updateMutation.isPending}
				>
					{updateMutation.isPending ? (
						"Saving…"
					) : saveSuccess ? (
						<>
							<Check className="size-4" /> Saved
						</>
					) : (
						"Save Slots"
					)}
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{WEEKDAYS.map((dayName, weekdayIndex) => {
					const daySlots = slots.filter((s) => s.weekday === weekdayIndex);
					const currentTimeInput = newTime[weekdayIndex] ?? "";

					return (
						<div
							key={dayName}
							className="rounded-lg border border-line bg-surface p-4 shadow-xs"
						>
							<div className="flex items-center justify-between border-b border-line pb-2">
								<span className="font-medium text-fg">{dayName}</span>
								<span className="text-xs text-faint">
									{daySlots.length} slots
								</span>
							</div>

							<div className="mt-3 space-y-2">
								{daySlots.length === 0 ? (
									<p className="py-2 text-center text-xs text-faint">
										No slots
									</p>
								) : (
									daySlots.map((slot) => (
										<div
											key={slot.time}
											className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition ${
												slot.enabled
													? "border-line bg-canvas text-fg"
													: "border-line/40 bg-sunken/40 text-faint line-through"
											}`}
										>
											<div className="flex items-center gap-2">
												<Clock className="size-3.5 text-faint" />
												<button
													type="button"
													className="font-mono text-xs hover:underline"
													onClick={() => handleToggle(weekdayIndex, slot.time)}
													title="Click to toggle enabled/disabled"
												>
													{slot.time}
												</button>
											</div>

											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => handleToggle(weekdayIndex, slot.time)}
													className="text-xs text-faint hover:text-fg"
												>
													{slot.enabled ? "Disable" : "Enable"}
												</button>
												<button
													type="button"
													onClick={() => handleRemove(weekdayIndex, slot.time)}
													className="rounded p-1 text-faint hover:text-danger"
													title="Remove slot"
												>
													<Trash2 className="size-3.5" />
												</button>
											</div>
										</div>
									))
								)}
							</div>

							<div className="mt-3 flex items-center gap-2 pt-2 border-t border-line/60">
								<Input
									type="text"
									placeholder="HH:MM"
									value={currentTimeInput}
									onChange={(e) =>
										setNewTime((prev) => ({
											...prev,
											[weekdayIndex]: e.target.value,
										}))
									}
									className="h-8 text-xs font-mono"
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAdd(weekdayIndex);
										}
									}}
								/>
								<Button
									variant="secondary"
									size="sm"
									className="h-8 px-2"
									onClick={() => handleAdd(weekdayIndex)}
									title="Add slot"
								>
									<Plus className="size-3.5" />
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
