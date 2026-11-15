import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { UploadView } from "@/components/upload/upload-view";

export const metadata: Metadata = { title: "Upload" };

/** Owned by the `media` slice (docs/jester.md "Pages"). */
export default function Page() {
	return (
		<>
			<PageHeader title="Upload" />
			<UploadView />
		</>
	);
}
