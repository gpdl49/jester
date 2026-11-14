import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Triage" };

/** Owned by the `triage` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Triage" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
