"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading, Spinner } from "@/components/ui/feedback";
import type { MemeStatus } from "@/lib/api/types";
import { useInfiniteMemes } from "@/lib/client/memes";
import { BulkBar } from "./bulk-bar";
import { FilterBar } from "./filter-bar";
import { MemeCard } from "./meme-card";

export function MemeGrid() {
	const searchParams = useSearchParams();

	const status = (searchParams.get("status") as MemeStatus) || undefined;
	const tag = searchParams.get("tag") || undefined;
	const template = searchParams.get("template") || undefined;
	const q = searchParams.get("q") || undefined;
	const minPostability = searchParams.get("minPostability")
		? Number(searchParams.get("minPostability"))
		: undefined;
	const sensitive = searchParams.get("sensitive")
		? searchParams.get("sensitive") === "true"
		: undefined;
	const hasAttribution = searchParams.get("hasAttribution")
		? searchParams.get("hasAttribution") === "true"
		: undefined;
	const duplicates = searchParams.get("duplicates")
		? searchParams.get("duplicates") === "true"
		: undefined;
	const sort =
		(searchParams.get("sort") as
			| "newest"
			| "oldest"
			| "postability"
			| "takenAt"
			| "rating"
			| "relevance") || "newest";

	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
		error,
	} = useInfiniteMemes({
		status,
		tag,
		template,
		q,
		minPostability,
		sensitive,
		hasAttribution,
		duplicates,
		sort,
		limit: 60,
	});

	const allMemes = data?.pages.flatMap((page) => page.items) ?? [];

	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

	const handleToggleSelect = useCallback(
		(id: string, shiftKey: boolean) => {
			setSelectedIds((prev) => {
				const isCurrentlySelected = prev.includes(id);

				if (shiftKey && lastSelectedId && lastSelectedId !== id) {
					const allIds = allMemes.map((m) => m.id);
					const fromIdx = allIds.indexOf(lastSelectedId);
					const toIdx = allIds.indexOf(id);
					if (fromIdx !== -1 && toIdx !== -1) {
						const start = Math.min(fromIdx, toIdx);
						const end = Math.max(fromIdx, toIdx);
						const rangeIds = allIds.slice(start, end + 1);
						const next = new Set([...prev, ...rangeIds]);
						return Array.from(next);
					}
				}

				setLastSelectedId(id);
				if (isCurrentlySelected) {
					return prev.filter((item) => item !== id);
				}
				return [...prev, id];
			});
		},
		[allMemes, lastSelectedId],
	);

	const handleClearSelection = useCallback(() => {
		setSelectedIds([]);
		setLastSelectedId(null);
	}, []);

	// Infinite scroll intersection observer
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!hasNextPage || isFetchingNextPage || !loadMoreRef.current) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					fetchNextPage();
				}
			},
			{ rootMargin: "400px" },
		);
		observer.observe(loadMoreRef.current);
		return () => observer.disconnect();
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	return (
		<div className="relative pb-24">
			<FilterBar />

			{isLoading ? (
				<Loading label="Loading memes…" />
			) : error ? (
				<EmptyState
					title="Failed to load memes"
					action={
						<Button
							variant="secondary"
							onClick={() => window.location.reload()}
						>
							Retry
						</Button>
					}
				>
					{error instanceof Error ? error.message : "An error occurred"}
				</EmptyState>
			) : allMemes.length === 0 ? (
				<EmptyState title="No memes found">
					Try clearing your filters or uploading new memes.
				</EmptyState>
			) : (
				<>
					{/* Masonry CSS Columns Grid */}
					<div
						data-testid="meme-grid"
						className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4"
					>
						{allMemes.map((meme) => (
							<MemeCard
								key={meme.id}
								meme={meme}
								selected={selectedIds.includes(meme.id)}
								onToggleSelect={handleToggleSelect}
							/>
						))}
					</div>

					{/* Infinite Scroll Trigger */}
					{hasNextPage && (
						<div
							ref={loadMoreRef}
							className="mt-8 flex justify-center py-6 text-sm text-muted"
						>
							{isFetchingNextPage ? (
								<div className="flex items-center gap-2">
									<Spinner className="size-4" />
									Loading more memes…
								</div>
							) : (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => fetchNextPage()}
								>
									Load more
								</Button>
							)}
						</div>
					)}
				</>
			)}

			<BulkBar
				selectedIds={selectedIds}
				onClearSelection={handleClearSelection}
			/>
		</div>
	);
}
