import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
	return (
		<>
			<PageHeader title="Dashboard" />
			<DashboardView />
		</>
	);
}
