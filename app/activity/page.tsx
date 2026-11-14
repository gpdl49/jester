import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityView } from "@/components/activity/activity-view";
import { PageHeader } from "@/components/page-header";
import { Loading } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
	return (
		<>
			<PageHeader title="Activity" />
			<Suspense fallback={<Loading label="Loading activity…" />}>
				<ActivityView />
			</Suspense>
		</>
	);
}
