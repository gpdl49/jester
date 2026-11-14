import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Activity" };

/** Owned by the `admin` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Activity" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
