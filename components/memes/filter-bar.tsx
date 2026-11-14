"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/components/ui/cn";
import { SearchBox } from "@/components/ui/search-box";
import { useTags } from "@/lib/client/memes";

export function FilterBar() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const currentQ = searchParams.get("q") ?? "";
	const currentStatus = searchParams.get("status") ?? "";
	const currentTag = searchParams.get("tag") ?? "";
	const currentTemplate = searchParams.get("template") ?? "";
	const currentSort = searchParams.get("sort") ?? "newest";
	const currentSensitive = searchParams.get("sensitive") === "true";
	const currentHasAttribution = searchParams.get("hasAttribution") === "true";
	const currentDuplicates = searchParams.get("duplicates") === "true";

	const { data: tags } = useTags();

	const updateFilter = useCallback(
		(key: string, value: string | boolean | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value === null || value === "" || value === false) {
				params.delete(key);
			} else {
				params.set(key, String(value));
			}

			// If search is cleared and sort was relevance, reset sort
			if (key === "q" && !value && params.get("sort") === "relevance") {
				params.delete("sort");
			}

			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[pathname, router, searchParams],
	);

	const resetFilters = useCallback(() => {
		router.replace(pathname, { scroll: false });
	}, [pathname, router]);

	const statusTabs = [
		{ label: "Active", value: "" },
		{ label: "Inbox", value: "inbox" },
		{ label: "Approved", value: "approved" },
		{ label: "Rejected", value: "rejected" },
		{ label: "Archived", value: "archived" },
	];

	return (
		<div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface/50 p-4 shadow-xs backdrop-blur-sm">
			{/* Row 1: Search & Status Tabs */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<SearchBox
					value={currentQ}
					onChange={(val) => updateFilter("q", val)}
					className="w-full sm:max-w-xs"
				/>

				{/* Status Tabs */}
				<div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-canvas p-1 text-xs">
					{statusTabs.map((tab) => (
						<button
							key={tab.value}
							type="button"
							onClick={() => updateFilter("status", tab.value || null)}
							className={cn(
								"rounded-md px-3 py-1 font-medium transition-colors",
								currentStatus === tab.value
									? "bg-surface text-fg shadow-xs"
									: "text-muted hover:text-fg",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Row 2: Selectors & Toggles */}
			<div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line/60 text-xs">
				{/* Tag Picker */}
				<select
					aria-label="Filter by tag"
					value={currentTag}
					onChange={(e) => updateFilter("tag", e.target.value || null)}
					className="h-8 rounded-lg border border-line bg-canvas px-2.5 text-xs text-fg outline-none focus:border-accent"
				>
					<option value="">All tags</option>
					{tags?.map((t) => (
						<option key={t.name} value={t.name}>
							#{t.name} ({t.count})
						</option>
					))}
				</select>

				{/* Template Input */}
				<input
					type="text"
					placeholder="Template…"
					aria-label="Filter by template"
					value={currentTemplate}
					onChange={(e) =>
						updateFilter("template", e.target.value.trim() || null)
					}
					className="h-8 w-28 rounded-lg border border-line bg-canvas px-2.5 text-xs text-fg placeholder:text-faint outline-none focus:border-accent"
				/>

				{/* Sort Selector */}
				<select
					aria-label="Sort by"
					value={currentSort}
					onChange={(e) => updateFilter("sort", e.target.value)}
					className="h-8 rounded-lg border border-line bg-canvas px-2.5 text-xs text-fg outline-none focus:border-accent"
				>
					{currentQ && <option value="relevance">Relevance</option>}
					<option value="newest">Newest</option>
					<option value="oldest">Oldest</option>
					<option value="postability">Postability</option>
					<option value="takenAt">Taken date</option>
					<option value="rating">Rating</option>
				</select>

				{/* Toggle: Sensitive */}
				<button
					type="button"
					aria-pressed={currentSensitive}
					onClick={() => updateFilter("sensitive", !currentSensitive)}
					className={cn(
						"h-8 rounded-lg border px-2.5 font-medium transition-colors",
						currentSensitive
							? "border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400"
							: "border-line bg-canvas text-muted hover:text-fg",
					)}
				>
					Sensitive
				</button>

				{/* Toggle: Attribution */}
				<button
					type="button"
					aria-pressed={currentHasAttribution}
					onClick={() => updateFilter("hasAttribution", !currentHasAttribution)}
					className={cn(
						"h-8 rounded-lg border px-2.5 font-medium transition-colors",
						currentHasAttribution
							? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
							: "border-line bg-canvas text-muted hover:text-fg",
					)}
				>
					Has attribution
				</button>

				{/* Toggle: Duplicates */}
				<button
					type="button"
					aria-pressed={currentDuplicates}
					onClick={() => updateFilter("duplicates", !currentDuplicates)}
					className={cn(
						"h-8 rounded-lg border px-2.5 font-medium transition-colors",
						currentDuplicates
							? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
							: "border-line bg-canvas text-muted hover:text-fg",
					)}
				>
					Duplicates
				</button>

				{/* Clear Filters */}
				{(currentQ ||
					currentStatus ||
					currentTag ||
					currentTemplate ||
					currentSort !== "newest" ||
					currentSensitive ||
					currentHasAttribution ||
					currentDuplicates) && (
					<button
						type="button"
						onClick={resetFilters}
						className="ml-auto text-xs text-muted hover:text-fg hover:underline"
					>
						Clear filters
					</button>
				)}
			</div>
		</div>
	);
}
