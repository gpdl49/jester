import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Queue" };

/** Owned by the `posts` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Queue" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
