import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { Loading } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
	return (
		<>
			<PageHeader title="Settings" />
			<Suspense fallback={<Loading label="Loading settings…" />}>
				<SettingsView />
			</Suspense>
		</>
	);
}
