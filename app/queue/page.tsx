import type { Metadata } from "next";
import { QueuePage } from "@/components/posts/queue-page";

export const metadata: Metadata = { title: "Queue" };

/** Owned by the `posts` slice (docs/jester.md "Pages"). */
export default function Page() {
	return <QueuePage />;
}
