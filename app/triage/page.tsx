import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { TriageView } from "@/components/triage/triage-view";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Triage" };

/** Owned by the `triage` slice (docs/jester.md "Pages"). */
export default async function Page() {
	let isAdmin = false;
	try {
		const reqHeaders = await headers();
		const user = await requireUser({ headers: reqHeaders });
		isAdmin = user.isAdmin;
	} catch {
		isAdmin = false;
	}

	return (
		<>
			<PageHeader title="Triage" />
			<TriageView isAdmin={isAdmin} />
		</>
	);
}
