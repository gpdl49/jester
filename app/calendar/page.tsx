import type { Metadata } from "next";
import { CalendarPage } from "@/components/schedule/calendar-page";

export const metadata: Metadata = { title: "Calendar" };

/** Owned by the `posts` slice (docs/jester.md "Pages"). */
export default function Page() {
	return <CalendarPage />;
}
