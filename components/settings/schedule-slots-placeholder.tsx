"use client";

import { Calendar } from "lucide-react";

export function ScheduleSlotsPlaceholder() {
	return (
		<div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
			<div className="flex items-center gap-2 font-medium text-fg">
				<Calendar className="size-4" />
				Posting Schedule Slots
			</div>
			<p className="mt-1">
				Schedule slot management is handled by the posts slice. Configure
				posting days and times for queued memes.
			</p>
		</div>
	);
}
