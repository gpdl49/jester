"use client";

import { formatDistanceToNow, parseISO } from "date-fns";
import {
	ArrowUpRight,
	Bot,
	ChevronDown,
	ChevronRight,
	Filter,
	History,
	RefreshCw,
	Trash2,
	User as UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorText, Loading } from "@/components/ui/feedback";
import type { AuditEventDto } from "@/lib/api/types";
import { useAuditEvents } from "@/lib/client/admin";

const COMMON_ACTION_FILTERS = [
	{ label: "All actions", value: "" },
	{ label: "Settings updates", value: "settings." },
	{ label: "Triage decisions", value: "triage." },
	{ label: "Meme curation", value: "meme." },
	{ label: "Immich deletions", value: "immich.delete" },
	{ label: "Post publishing", value: "post." },
	{ label: "Instagram accounts", value: "instagram." },
];

export function ActivityView() {
	const [activeTab, setActiveTab] = useState<"all" | "deletions">("all");
	const [actionFilter, setActionFilter] = useState("");

	// The query uses the tab or action filter
	const queryAction =
		activeTab === "deletions" ? "immich.delete" : actionFilter || undefined;

	const { data, isLoading, isFetching, error, refetch } = useAuditEvents({
		action: queryAction,
		limit: 50,
	});

	// Display items: fresh from query or accumulated
	const currentItems = data?.items ?? [];
	const hasMore = Boolean(data?.nextCursor);

	return (
		<div className="space-y-6 pb-12">
			{/* Tab Switcher */}
			<div className="flex items-center justify-between border-b border-line pb-3">
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => setActiveTab("all")}
						className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
							activeTab === "all"
								? "bg-accent text-accent-fg"
								: "text-muted hover:text-fg hover:bg-sunken"
						}`}
					>
						<span className="flex items-center gap-2">
							<History className="size-4" />
							Audit Log
						</span>
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("deletions")}
						className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
							activeTab === "deletions"
								? "bg-accent text-accent-fg"
								: "text-muted hover:text-fg hover:bg-sunken"
						}`}
					>
						<span className="flex items-center gap-2">
							<Trash2 className="size-4" />
							Immich Deletions
						</span>
					</button>
				</div>

				<Button
					variant="ghost"
					size="sm"
					onClick={() => void refetch()}
					disabled={isFetching}
					className="text-xs text-muted"
				>
					<RefreshCw
						className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
					/>
					Refresh
				</Button>
			</div>

			{/* Filters for Audit Log */}
			{activeTab === "all" && (
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-2 text-xs text-muted">
						<Filter className="size-3.5" />
						Filter:
					</div>
					<div className="flex flex-wrap gap-1.5">
						{COMMON_ACTION_FILTERS.map((f) => (
							<button
								key={f.value}
								type="button"
								onClick={() => setActionFilter(f.value)}
								className={`rounded-md px-2.5 py-1 text-xs transition ${
									actionFilter === f.value
										? "bg-sunken border border-line-strong text-fg font-semibold"
										: "text-muted hover:text-fg hover:bg-sunken/60 border border-transparent"
								}`}
							>
								{f.label}
							</button>
						))}
					</div>
				</div>
			)}

			{isLoading && <Loading label="Loading activity events…" />}
			{error && <ErrorText error={error} />}

			{!isLoading && currentItems.length === 0 && (
				<div className="rounded-2xl border border-dashed border-line p-12 text-center text-sm text-muted">
					No audit events found{queryAction ? ` matching "${queryAction}"` : ""}
					.
				</div>
			)}

			{/* Deletions Tab View */}
			{activeTab === "deletions" && currentItems.length > 0 && (
				<ImmichDeletionsList items={currentItems} />
			)}

			{/* All Events Tab View */}
			{activeTab === "all" && currentItems.length > 0 && (
				<AuditEventsList items={currentItems} />
			)}

			{/* Pagination Footer */}
			{hasMore && (
				<div className="pt-4 text-center">
					<Button
						variant="secondary"
						size="md"
						onClick={() => {
							// In a full infinite scroll this appends pages, or we can refresh with cursor
						}}
					>
						Showing latest {currentItems.length} events
					</Button>
				</div>
			)}
		</div>
	);
}

function AuditEventsList({ items }: { items: AuditEventDto[] }) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	function toggleExpand(id: string) {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setExpandedIds(next);
	}

	return (
		<div className="divide-y divide-line rounded-2xl border border-line bg-surface overflow-hidden">
			{items.map((event) => {
				const date = parseISO(event.at);
				const isExpanded = expandedIds.has(event.id);
				const hasData = event.data && Object.keys(event.data).length > 0;

				return (
					<div
						key={event.id}
						className="p-4 transition hover:bg-sunken/30 text-sm space-y-2"
					>
						<div className="flex items-start justify-between gap-4">
							<div className="flex items-center gap-2 min-w-0">
								<span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-sunken border border-line text-fg">
									{event.action}
								</span>
								<span className="text-xs text-muted">
									on <strong className="text-fg">{event.subjectType}</strong>
									{event.subjectId && (
										<span className="font-mono text-[11px] text-faint ml-1">
											({event.subjectId.slice(0, 8)})
										</span>
									)}
								</span>
							</div>

							<div className="flex items-center gap-3 shrink-0 text-xs text-muted">
								<div className="flex items-center gap-1.5">
									{event.actor ? (
										<>
											<UserIcon className="size-3 text-muted" />
											<span className="font-medium text-fg">
												{event.actor.username || event.actor.email}
											</span>
										</>
									) : (
										<>
											<Bot className="size-3 text-faint" />
											<span className="text-faint">System</span>
										</>
									)}
								</div>
								<span>•</span>
								<time
									dateTime={event.at}
									title={date.toLocaleString()}
									className="text-faint"
								>
									{formatDistanceToNow(date, { addSuffix: true })}
								</time>
							</div>
						</div>

						{hasData && (
							<div>
								<button
									type="button"
									onClick={() => toggleExpand(event.id)}
									className="flex items-center gap-1 text-xs text-accent hover:underline"
								>
									{isExpanded ? (
										<ChevronDown className="size-3" />
									) : (
										<ChevronRight className="size-3" />
									)}
									{isExpanded ? "Hide details" : "Show details"}
								</button>

								{isExpanded && (
									<pre className="mt-2 rounded-lg border border-line bg-sunken p-3 text-xs font-mono text-fg overflow-x-auto whitespace-pre-wrap">
										{JSON.stringify(event.data, null, 2)}
									</pre>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function ImmichDeletionsList({ items }: { items: AuditEventDto[] }) {
	return (
		<div className="space-y-3">
			<div className="rounded-xl border border-line bg-surface p-4 text-xs text-muted">
				Immich deletions occur after an accepted asset has been verified and
				stored in S3. Permanent deletion removes the duplicate asset from your
				Immich photo library.
			</div>

			<div className="divide-y divide-line rounded-2xl border border-line bg-surface overflow-hidden">
				{items.map((event) => {
					const date = parseISO(event.at);
					const data = event.data as {
						memeId?: string;
						status?: string;
						immichId?: string;
						verifiedSha256?: string;
					};

					const memeId =
						data.memeId ||
						(event.subjectType === "meme" ? event.subjectId : null);
					const status = data.status || "done";

					return (
						<div
							key={event.id}
							className="p-4 transition hover:bg-sunken/30 text-sm flex items-center justify-between gap-4"
						>
							<div className="space-y-1 min-w-0">
								<div className="flex items-center gap-2">
									<span
										className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
											status === "done"
												? "bg-success/20 text-success"
												: status === "skipped"
													? "bg-warning/20 text-warning"
													: "bg-danger-soft text-danger"
										}`}
									>
										{status.toUpperCase()}
									</span>

									{data.immichId && (
										<span className="font-mono text-xs text-muted">
											Immich: {data.immichId.slice(0, 8)}…
										</span>
									)}
								</div>

								{data.verifiedSha256 && (
									<div className="font-mono text-[11px] text-faint truncate max-w-md">
										Verified SHA-256: {data.verifiedSha256}
									</div>
								)}
							</div>

							<div className="flex items-center gap-4 shrink-0">
								{memeId && (
									<Link
										href={`/memes/${memeId}`}
										className="inline-flex items-center gap-1 rounded-lg border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-accent hover:bg-sunken/80 transition"
									>
										View Meme <ArrowUpRight className="size-3" />
									</Link>
								)}

								<div className="text-right text-xs">
									<time
										dateTime={event.at}
										title={date.toLocaleString()}
										className="text-fg font-medium"
									>
										{formatDistanceToNow(date, { addSuffix: true })}
									</time>
									<div className="text-[11px] text-faint">
										{event.actor?.username || "System"}
									</div>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
