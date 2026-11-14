"use client";

import { PageHeader } from "@/components/page-header";
import { CalendarGrid } from "./calendar-grid";

export function CalendarPage() {
	return (
		<>
			<PageHeader title="Calendar" />
			<div className="py-6">
				<CalendarGrid days={14} />
			</div>
		</>
	);
}
