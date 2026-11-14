import type { Metadata } from "next";
import { ActivityView } from "@/components/activity/activity-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
	return (
		<>
			<PageHeader title="Activity" />
			<ActivityView />
		</>
	);
}
