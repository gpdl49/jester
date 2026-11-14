import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata: Metadata = { title: "Meme" };

/** Owned by the `library` slice (docs/memes.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Meme" />
			<Placeholder>Not built yet.</Placeholder>
		</>
	);
}
