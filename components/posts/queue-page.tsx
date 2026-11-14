"use client";

import { PageHeader } from "@/components/page-header";
import { usePosts } from "@/lib/client/posts";
import { QueueList } from "./queue-list";

export function QueuePage() {
	const { data: queuedData, isLoading: loadingQueued } = usePosts({
		status: "queued",
	});
	const { data: draftsData, isLoading: loadingDrafts } = usePosts({
		status: "draft",
	});

	const isLoading = loadingQueued || loadingDrafts;

	return (
		<>
			<PageHeader title="Queue" />
			<div className="py-6">
				{isLoading ? (
					<div className="py-12 text-center text-sm text-faint">
						Loading queue…
					</div>
				) : (
					<QueueList
						queuedPosts={queuedData?.items ?? []}
						draftPosts={draftsData?.items ?? []}
					/>
				)}
			</div>
		</>
	);
}
