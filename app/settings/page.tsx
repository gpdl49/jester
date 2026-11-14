import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Settings" };

/** Owned by the `admin` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Settings" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
