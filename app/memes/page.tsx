import type { Metadata } from "next";
import { Suspense } from "react";
import { MemeGrid } from "@/components/memes/meme-grid";
import { PageHeader } from "@/components/page-header";
import { Loading } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
	return (
		<>
			<PageHeader title="Library" />
			<Suspense fallback={<Loading label="Loading library…" />}>
				<MemeGrid />
			</Suspense>
		</>
	);
}
