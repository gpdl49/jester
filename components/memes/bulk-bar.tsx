"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBulkMemes } from "@/lib/client/memes";

export function BulkBar({
	selectedIds,
	onClearSelection,
}: {
	selectedIds: string[];
	onClearSelection: () => void;
}) {
	const { mutate: runBulk, isPending } = useBulkMemes();
	const [tagInputOpen, setTagInputOpen] = useState<"tag" | "untag" | null>(
		null,
	);
	const [tagName, setTagName] = useState("");
	const [error, setError] = useState<string | null>(null);

	if (selectedIds.length === 0) return null;

	const handleAction = (
		action:
			| "approve"
			| "reject"
			| "archive"
			| "tag"
			| "untag"
			| "analyze"
			| "attribute",
		tag?: string,
	) => {
		setError(null);
		runBulk(
			{ ids: selectedIds, action, tag },
			{
				onSuccess: () => {
					setTagInputOpen(null);
					setTagName("");
					onClearSelection();
				},
				onError: (err) => {
					setError(err instanceof Error ? err.message : "Bulk action failed");
				},
			},
		);
	};

	return (
		<div className="fixed bottom-6 inset-x-0 z-40 mx-auto flex max-w-2xl flex-col gap-2 px-4 pointer-events-auto">
			{error && (
				<div className="rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-danger shadow-md">
					{error}
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-xl backdrop-blur-md">
				<div className="flex items-center gap-2">
					<span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
						{selectedIds.length}
					</span>
					<span className="text-sm font-medium text-fg">selected</span>
					<button
						type="button"
						onClick={onClearSelection}
						className="ml-1 text-xs text-muted hover:text-fg hover:underline"
					>
						Clear
					</button>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() => handleAction("approve")}
					>
						Approve
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() => handleAction("reject")}
					>
						Reject
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() => handleAction("archive")}
					>
						Archive
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() =>
							setTagInputOpen(tagInputOpen === "tag" ? null : "tag")
						}
					>
						Tag…
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() =>
							setTagInputOpen(tagInputOpen === "untag" ? null : "untag")
						}
					>
						Untag…
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() => handleAction("analyze")}
					>
						Analyze
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPending}
						onClick={() => handleAction("attribute")}
					>
						Attribute
					</Button>
				</div>
			</div>

			{/* Inline Tag Input */}
			{tagInputOpen && (
				<div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg">
					<input
						type="text"
						placeholder={`Tag name to ${tagInputOpen}…`}
						value={tagName}
						onChange={(e) => setTagName(e.target.value)}
						className="h-8 flex-1 rounded-lg border border-line bg-canvas px-2.5 text-xs text-fg outline-none focus:border-accent"
						onKeyDown={(e) => {
							if (e.key === "Enter" && tagName.trim()) {
								handleAction(tagInputOpen, tagName.trim());
							}
						}}
					/>
					<Button
						size="sm"
						variant="primary"
						disabled={!tagName.trim() || isPending}
						onClick={() => handleAction(tagInputOpen, tagName.trim())}
					>
						Apply
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setTagInputOpen(null);
							setTagName("");
						}}
					>
						Cancel
					</Button>
				</div>
			)}
		</div>
	);
}
