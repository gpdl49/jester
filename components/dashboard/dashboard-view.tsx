"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
	AlertCircle,
	ArrowRight,
	Calendar,
	CheckCircle2,
	Clock,
	Image as ImageIcon,
	Layers,
	ListOrdered,
	RefreshCw,
	ScanSearch,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { ErrorText, Loading } from "@/components/ui/feedback";
import type { DashboardStatsDto, Paged, PostSummaryDto } from "@/lib/api/types";
import { useAiUsage, useDashboardStats } from "@/lib/client/admin";
import { api } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/queries";

export function DashboardView() {
	const { data: stats, isLoading, error } = useDashboardStats();
	const { data: aiUsage } = useAiUsage(30);

	// /posts?status=queued is ordered by queue position, not by time, and
	// unscheduled posts sort first; take the three scheduled posts due soonest.
	const { data: upcomingScheduled } = useQuery({
		queryKey: [...queryKeys.posts, "queued-upcoming"],
		queryFn: async () => {
			const page = await api.get<Paged<PostSummaryDto>>("/posts", {
				status: "queued",
				limit: 100,
			});
			return page.items
				.filter((p) => p.scheduledAt !== null)
				.sort((a, b) =>
					(a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""),
				)
				.slice(0, 3);
		},
		retry: false,
	});

	if (isLoading) {
		return <Loading label="Loading dashboard stats…" />;
	}

	if (error || !stats) {
		return <ErrorText error={error ?? "Failed to load dashboard"} />;
	}

	// Determine next posts: from /posts API if available, else fall back to stats.nextPost
	const upcomingPosts: PostSummaryDto[] =
		upcomingScheduled && upcomingScheduled.length > 0
			? upcomingScheduled
			: stats.nextPost
				? [stats.nextPost]
				: [];

	return (
		<div className="space-y-8 pb-12">
			{/* Feature status chips */}
			<FeatureStatusChips features={stats.features} />

			{/* Metric tiles */}
			<DashboardTiles stats={stats} />

			{/* Pipeline funnel */}
			<PipelineFunnel stats={stats} />

			{/* Two column grid: Upcoming scheduled posts & AI Spend */}
			<div className="grid gap-6 lg:grid-cols-2">
				<UpcomingPosts posts={upcomingPosts} />
				<AiSpendCard aiSpend={stats.aiSpend} usage={aiUsage ?? []} />
			</div>

			{/* Sync status */}
			<SyncStatusCard sync={stats.sync} />
		</div>
	);
}

function FeatureStatusChips({
	features,
}: {
	features: DashboardStatsDto["features"];
}) {
	const items = [
		{
			id: "ai",
			label: features.ai
				? "AI active"
				: "AI: OpenRouter API key not configured",
			active: features.ai,
		},
		{
			id: "immich",
			label: features.immich
				? "Immich sync active"
				: "Immich: API key not configured",
			active: features.immich,
		},
		{
			id: "immichDelete",
			label: features.immichDelete
				? "Immich deletion enabled"
				: "Immich deletion disabled (IMMICH_DELETE_ENABLED=false)",
			active: features.immichDelete,
		},
		{
			id: "instagram",
			label: features.instagram
				? "Instagram publishing active"
				: "Instagram: credentials not configured",
			active: features.instagram,
		},
	];

	return (
		<div className="flex flex-wrap gap-2">
			{items.map((item) => (
				<Link
					key={item.id}
					href="/settings"
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
						item.active
							? "border border-success/30 bg-success/10 text-success hover:bg-success/20"
							: "border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
					}`}
				>
					<span
						className={`size-1.5 rounded-full ${
							item.active ? "bg-success" : "bg-warning"
						}`}
					/>
					{item.label}
				</Link>
			))}
		</div>
	);
}

function DashboardTiles({ stats }: { stats: DashboardStatsDto }) {
	const tiles = [
		{
			label: "To Review",
			value: stats.triage.scored,
			sub: "Triage scored",
			href: "/triage",
			icon: ScanSearch,
			color: "text-accent",
		},
		{
			label: "Inbox",
			value: stats.memes.inbox,
			sub: "Imported memes",
			href: "/memes?status=inbox",
			icon: ImageIcon,
			color: "text-fg",
		},
		{
			label: "Approved",
			value: stats.memes.approved,
			sub: "Ready to post",
			href: "/memes?status=approved",
			icon: CheckCircle2,
			color: "text-success",
		},
		{
			label: "Queued",
			value: stats.queuedPosts,
			sub: "In post queue",
			href: "/queue",
			icon: ListOrdered,
			color: "text-accent",
		},
		{
			label: "Archived",
			value: stats.memes.archived,
			sub: "Archived memes",
			href: "/memes?status=archived",
			icon: Calendar,
			color: "text-muted",
		},
	];

	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
			{tiles.map((tile) => {
				const Icon = tile.icon;
				return (
					<Link
						key={tile.label}
						href={tile.href}
						className="group rounded-2xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-sm"
					>
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-muted">
								{tile.label}
							</span>
							<Icon className={`size-4 ${tile.color}`} />
						</div>
						<div className="mt-2 text-2xl font-bold tracking-tight text-fg">
							{tile.value.toLocaleString()}
						</div>
						<div className="mt-1 flex items-center justify-between text-xs text-muted">
							<span>{tile.sub}</span>
							<ArrowRight className="size-3 text-faint transition group-hover:translate-x-0.5 group-hover:text-fg" />
						</div>
					</Link>
				);
			})}
		</div>
	);
}

function PipelineFunnel({ stats }: { stats: DashboardStatsDto }) {
	const prefiltered =
		stats.sync.assetsSeen > 0
			? stats.sync.assetsSeen
			: stats.triage.unscored +
				stats.triage.pending +
				stats.triage.scored +
				stats.triage.accepted +
				stats.triage.rejected +
				stats.triage.imported +
				stats.triage.deleted;

	const triaged =
		stats.triage.scored +
		stats.triage.accepted +
		stats.triage.rejected +
		stats.triage.imported +
		stats.triage.deleted;

	const accepted =
		stats.triage.accepted + stats.triage.imported + stats.triage.deleted;
	const imported = stats.triage.imported + stats.triage.deleted;
	const deleted = stats.triage.deleted;

	const stages = [
		{
			name: "Prefiltered",
			count: prefiltered,
			description: "Immich candidates",
			href: "/triage",
		},
		{
			name: "Triaged",
			count: triaged,
			description: "Classified by AI",
			href: "/triage",
		},
		{
			name: "Accepted",
			count: accepted,
			description: "Approved for S3",
			href: "/triage?status=accepted",
		},
		{
			name: "Imported",
			count: imported,
			description: "Stored in S3 & DB",
			href: "/memes",
		},
		{
			name: "Deleted from Immich",
			count: deleted,
			description: "Cleaned from Immich",
			href: "/activity?action=immich.delete",
		},
	];

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-fg flex items-center gap-2">
						<Layers className="size-4 text-accent" />
						Pipeline Funnel
					</h2>
					<p className="text-xs text-muted">
						Lifecycle from photo library candidate through AI triage, S3 import
						and Immich cleanup.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
				{stages.map((stage, i) => {
					const pct =
						prefiltered > 0 ? Math.round((stage.count / prefiltered) * 100) : 0;
					return (
						<Link
							key={stage.name}
							href={stage.href}
							className="group relative rounded-xl border border-line bg-sunken/40 p-4 transition hover:bg-sunken hover:border-line-strong"
						>
							<div className="text-xs font-medium text-muted">Step {i + 1}</div>
							<div className="mt-1 text-sm font-semibold text-fg group-hover:text-accent">
								{stage.name}
							</div>
							<div className="mt-2 text-xl font-bold tracking-tight text-fg">
								{stage.count.toLocaleString()}
							</div>
							<div className="mt-1 text-xs text-faint flex justify-between">
								<span>{stage.description}</span>
								<span>{pct}%</span>
							</div>
							<div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
								<div
									className="h-full bg-accent transition-all duration-500"
									style={{ width: `${Math.min(pct, 100)}%` }}
								/>
							</div>
						</Link>
					);
				})}
			</div>
		</section>
	);
}

function UpcomingPosts({ posts }: { posts: PostSummaryDto[] }) {
	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-4 flex flex-col justify-between">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-fg flex items-center gap-2">
						<Calendar className="size-4 text-accent" />
						Scheduled Posts
					</h2>
					<p className="text-xs text-muted">
						Next upcoming posts queued for Instagram.
					</p>
				</div>
				<Link
					href="/queue"
					className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
				>
					View Queue <ArrowRight className="size-3" />
				</Link>
			</div>

			{posts.length === 0 ? (
				<div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
					No posts scheduled. Queue approved memes from the library to fill
					posting slots.
				</div>
			) : (
				<div className="space-y-3">
					{posts.map((post) => {
						const date = post.scheduledAt ? parseISO(post.scheduledAt) : null;
						return (
							<Link
								key={post.id}
								href={`/posts/${post.id}`}
								className="group flex items-center gap-3 rounded-xl border border-line bg-sunken/30 p-3 transition hover:bg-sunken"
							>
								{post.thumbUrl ? (
									// biome-ignore lint/performance/noImgElement: direct thumbnail url from media api
									<img
										src={post.thumbUrl}
										alt="Post thumbnail"
										className="size-14 rounded-lg object-cover border border-line"
									/>
								) : (
									<div className="size-14 rounded-lg bg-sunken border border-line flex items-center justify-center text-muted">
										<ImageIcon className="size-6" />
									</div>
								)}

								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-xs font-semibold text-fg">
											{date
												? formatDistanceToNow(date, { addSuffix: true })
												: "Unscheduled"}
										</span>
										<span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent uppercase">
											{post.kind}
										</span>
									</div>
									<p className="mt-0.5 truncate text-xs text-muted font-sans">
										{post.caption || "No caption"}
									</p>
									{date && (
										<div className="mt-1 flex items-center gap-1 text-[11px] text-faint">
											<Clock className="size-3" />
											{date.toLocaleString()}
										</div>
									)}
								</div>
								<ArrowRight className="size-4 text-faint group-hover:text-fg group-hover:translate-x-0.5 transition" />
							</Link>
						);
					})}
				</div>
			)}
		</section>
	);
}

function AiSpendCard({
	aiSpend,
	usage,
}: {
	aiSpend: DashboardStatsDto["aiSpend"];
	usage: Array<{ day: string; costUsd: number; calls: number }>;
}) {
	// A budget of 0 is valid (AI jobs are blocked), so no fallback value.
	const budget = aiSpend.dailyBudgetUsd;
	const pct =
		budget > 0
			? Math.min(Math.round((aiSpend.todayUsd / budget) * 100), 100)
			: 100;

	// Aggregate usage by day for SVG bar chart
	const dayMap = new Map<string, number>();
	for (const item of usage) {
		dayMap.set(item.day, (dayMap.get(item.day) ?? 0) + item.costUsd);
	}

	// Build last 30 days
	const now = new Date();
	const daysData: Array<{ day: string; cost: number }> = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
		);
		const key = d.toISOString().slice(0, 10);
		daysData.push({ day: key, cost: dayMap.get(key) ?? 0 });
	}

	const maxCost = Math.max(...daysData.map((d) => d.cost), 0.1);

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-fg flex items-center gap-2">
						<Sparkles className="size-4 text-accent" />
						AI Spend & Budget
					</h2>
					<p className="text-xs text-muted">
						Daily and 30-day OpenRouter costs.
					</p>
				</div>
				<Link
					href="/settings"
					className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
				>
					Budget Settings <ArrowRight className="size-3" />
				</Link>
			</div>

			{/* Progress bar today */}
			<div className="rounded-xl border border-line bg-sunken/40 p-4 space-y-2">
				<div className="flex justify-between text-xs">
					<span className="font-medium text-fg">
						Today: ${aiSpend.todayUsd.toFixed(4)} of ${budget.toFixed(2)}
					</span>
					<span className="text-muted">{pct}%</span>
				</div>
				<div className="h-2 w-full overflow-hidden rounded-full bg-line">
					<div
						className={`h-full transition-all duration-500 ${
							pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent"
						}`}
						style={{ width: `${pct}%` }}
					/>
				</div>
				<div className="flex justify-between text-[11px] text-faint">
					<span>Month to date: ${aiSpend.monthUsd.toFixed(4)}</span>
					<span>Resets 00:00 UTC</span>
				</div>
			</div>

			{/* Plain SVG 30-day bar chart */}
			<div className="space-y-1">
				<div className="flex justify-between text-xs text-muted">
					<span>30-Day Spend Trend</span>
					<span>Max: ${maxCost.toFixed(2)}/day</span>
				</div>
				<div className="h-28 w-full rounded-xl border border-line bg-sunken/30 p-2">
					<svg
						viewBox="0 0 300 80"
						className="size-full overflow-visible"
						preserveAspectRatio="none"
					>
						<title>30-Day AI Spend Trend</title>
						{daysData.map((d, i) => {
							const height = (d.cost / maxCost) * 70;
							const x = i * 10 + 1;
							const y = 80 - Math.max(height, 2);
							return (
								<rect
									key={d.day}
									x={x}
									y={y}
									width={7}
									height={Math.max(height, 2)}
									rx={1.5}
									className="fill-accent transition hover:fill-accent-fg cursor-pointer"
								>
									<title>{`${d.day}: $${d.cost.toFixed(4)}`}</title>
								</rect>
							);
						})}
					</svg>
				</div>
				<div className="flex justify-between text-[10px] text-faint px-1">
					<span>30 days ago</span>
					<span>15 days ago</span>
					<span>Today</span>
				</div>
			</div>
		</section>
	);
}

function SyncStatusCard({ sync }: { sync: DashboardStatsDto["sync"] }) {
	const lastRun = sync.lastRunAt ? parseISO(sync.lastRunAt) : null;

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-fg flex items-center gap-2">
						<RefreshCw className="size-4 text-accent" />
						Immich Sync Status
					</h2>
					<p className="text-xs text-muted">
						Periodic polling and backfill progress.
					</p>
				</div>
				<Link
					href="/activity?action=immich"
					className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
				>
					Sync History <ArrowRight className="size-3" />
				</Link>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
				<div className="rounded-xl border border-line bg-sunken/30 p-3">
					<div className="text-xs text-muted">Last Polled</div>
					<div className="mt-1 text-sm font-semibold text-fg">
						{lastRun
							? formatDistanceToNow(lastRun, { addSuffix: true })
							: "Never"}
					</div>
					<div className="text-[11px] text-faint">
						{lastRun ? lastRun.toLocaleTimeString() : "Pending first run"}
					</div>
				</div>

				<div className="rounded-xl border border-line bg-sunken/30 p-3">
					<div className="text-xs text-muted">Backfill Progress</div>
					<div className="mt-1 text-sm font-semibold text-fg">
						{sync.backfillDone ? "Completed" : `Page ${sync.backfillPage}`}
					</div>
					<div className="text-[11px] text-faint">
						{sync.backfillDone ? "All history indexed" : "Resuming next tick"}
					</div>
				</div>

				<div className="rounded-xl border border-line bg-sunken/30 p-3">
					<div className="text-xs text-muted">Total Assets Scanned</div>
					<div className="mt-1 text-sm font-semibold text-fg">
						{sync.assetsSeen.toLocaleString()}
					</div>
					<div className="text-[11px] text-faint">In Immich library</div>
				</div>

				<div className="rounded-xl border border-line bg-sunken/30 p-3">
					<div className="text-xs text-muted">Health</div>
					<div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
						{sync.lastError ? (
							<>
								<AlertCircle className="size-4 text-danger" />
								<span className="text-danger truncate" title={sync.lastError}>
									{sync.lastError}
								</span>
							</>
						) : (
							<>
								<CheckCircle2 className="size-4 text-success" />
								<span className="text-success">Healthy</span>
							</>
						)}
					</div>
					<div className="text-[11px] text-faint">
						{sync.lastError ? "Investigate error" : "No recent errors"}
					</div>
				</div>
			</div>
		</section>
	);
}
