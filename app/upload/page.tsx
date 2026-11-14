import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Upload" };

/** Owned by the `media` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Upload" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
