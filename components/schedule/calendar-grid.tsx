"use client";

import { format, isSameDay } from "date-fns";
import { ArrowRight, CheckCircle2, Clock, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useSchedulePreview } from "@/lib/client/posts";

export function CalendarGrid({ days = 14 }: { days?: number }) {
	const { data: preview, isLoading, error } = useSchedulePreview(days);

	if (isLoading) {
		return (
			<div className="py-12 text-center text-sm text-faint">
				Loading calendar slots…
			</div>
		);
	}

	if (error) {
		return (
			<div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
				Failed to load schedule preview.
			</div>
		);
	}

	if (!preview || preview.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-line p-12 text-center text-sm text-faint">
				No schedule slots configured. Configure recurring slots in settings.
			</div>
		);
	}

	// Group slot instants by day
	const groupedDays: { date: Date; slots: typeof preview }[] = [];
	for (const item of preview) {
		const dt = new Date(item.at);
		const existing = groupedDays.find((g) => isSameDay(g.date, dt));
		if (existing) {
			existing.slots.push(item);
		} else {
			groupedDays.push({ date: dt, slots: [item] });
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between text-xs text-faint">
				<span>Showing 14-day slot schedule projection</span>
				<div className="flex items-center gap-4">
					<div className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-emerald-500" />
						<span>Filled slot</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-amber-500" />
						<span>Empty slot</span>
					</div>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{groupedDays.map((group) => {
					const dateStr = format(group.date, "EEEE, MMM d");
					return (
						<div
							key={group.date.toISOString()}
							className="rounded-xl border border-line bg-surface p-4 shadow-xs flex flex-col justify-between"
						>
							<div>
								<div className="border-b border-line pb-2.5">
									<h3 className="font-semibold text-fg text-sm">{dateStr}</h3>
									<span className="text-xs text-faint">
										{group.slots.length}{" "}
										{group.slots.length === 1 ? "slot" : "slots"}
									</span>
								</div>

								<div className="mt-3 space-y-2.5">
									{group.slots.map((slot) => {
										const slotDate = new Date(slot.at);
										const timeStr = format(slotDate, "h:mm a");
										const isFilled = Boolean(slot.postId);

										return (
											<div
												key={slot.at}
												className={`rounded-lg border p-3 transition ${
													isFilled
														? "border-emerald-500/30 bg-emerald-500/5 text-fg"
														: "border-amber-500/40 border-dashed bg-amber-500/5 text-amber-300"
												}`}
											>
												<div className="flex items-center justify-between">
													<div className="flex items-center gap-1.5 font-mono text-xs font-medium">
														<Clock className="size-3.5 opacity-70" />
														<span>{timeStr}</span>
													</div>
													{isFilled ? (
														<span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
															<CheckCircle2 className="size-3" /> Filled
														</span>
													) : (
														<span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
															<PlusCircle className="size-3" /> Empty
														</span>
													)}
												</div>

												{isFilled && slot.postId && (
													<div className="mt-2 pt-2 border-t border-line/40 flex items-center justify-between text-xs">
														<span className="font-mono text-faint">
															Post #{slot.postId.slice(0, 8)}
														</span>
														<Link
															href={`/posts/${slot.postId}`}
															className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
														>
															View <ArrowRight className="size-3" />
														</Link>
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
