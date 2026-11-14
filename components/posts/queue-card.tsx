"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
	Clock,
	Edit,
	Globe,
	GripVertical,
	Layers,
	Send,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PostSummaryDto } from "@/lib/api/types";

export type QueueCardProps = {
	post: PostSummaryDto;
	scheduleTimezone?: string;
	onPublishNow?: (id: string) => void;
	onCancel?: (id: string) => void;
	dragHandleProps?: Record<string, unknown>;
	isDraggable?: boolean;
};

export function QueueCard({
	post,
	scheduleTimezone = "Asia/Kolkata",
	onPublishNow,
	onCancel,
	dragHandleProps,
	isDraggable = false,
}: QueueCardProps) {
	// Formatted dates
	let localTimeStr = "Unscheduled";
	let scheduleTzTimeStr = "";

	if (post.scheduledAt) {
		const dt = new Date(post.scheduledAt);
		localTimeStr = format(dt, "MMM d, yyyy h:mm a");

		try {
			const tzDate = new TZDate(dt, scheduleTimezone);
			scheduleTzTimeStr = `${format(tzDate, "MMM d, h:mm a")} (${scheduleTimezone})`;
		} catch {
			scheduleTzTimeStr = "";
		}
	}

	const statusColors: Record<string, string> = {
		draft: "bg-surface text-faint border-line",
		queued: "bg-blue-500/10 text-blue-400 border-blue-500/30",
		publishing:
			"bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse",
		published: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
		failed: "bg-danger/10 text-danger border-danger/30",
		cancelled: "bg-sunken text-faint border-line/40 line-through",
	};

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-start gap-3.5">
				{isDraggable && (
					<button
						type="button"
						{...dragHandleProps}
						className="cursor-grab text-faint hover:text-fg active:cursor-grabbing self-center p-1"
						aria-label="Drag to reorder"
					>
						<GripVertical className="size-4" />
					</button>
				)}

				{/* Thumbnail */}
				<div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-canvas border border-line">
					{post.thumbUrl ? (
						// biome-ignore lint/performance/noImgElement: dynamic thumbnail
						<img
							src={post.thumbUrl}
							alt={post.caption || "Post thumbnail"}
							className="size-full object-cover"
						/>
					) : (
						<div className="flex size-full items-center justify-center text-xs text-faint">
							No thumb
						</div>
					)}
					{post.kind === "carousel" && (
						<div className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[9px] font-bold text-white flex items-center gap-0.5">
							<Layers className="size-2.5" />
							{post.itemCount}
						</div>
					)}
				</div>

				{/* Details */}
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
								statusColors[post.status] ?? statusColors.draft
							}`}
						>
							{post.status}
						</span>

						{post.queuePosition !== null && post.status === "queued" && (
							<span className="text-xs font-mono text-faint">
								#{post.queuePosition} in queue
							</span>
						)}
					</div>

					<p className="line-clamp-2 text-sm text-fg">
						{post.caption || (
							<span className="text-faint italic">No caption</span>
						)}
					</p>

					{/* Scheduled time info */}
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
						<div className="flex items-center gap-1">
							<Clock className="size-3" />
							<span>{localTimeStr}</span>
						</div>
						{scheduleTzTimeStr && (
							<div className="flex items-center gap-1 text-[11px]">
								<Globe className="size-3" />
								<span>{scheduleTzTimeStr}</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="flex items-center gap-2 self-end sm:self-center">
				<Button variant="secondary" size="sm" asChild>
					<Link href={`/posts/${post.id}`}>
						<Edit className="size-3.5" />
						Edit
					</Link>
				</Button>

				{(post.status === "draft" || post.status === "queued") && (
					<>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => onPublishNow?.(post.id)}
							title="Publish to Instagram immediately"
						>
							<Send className="size-3.5" />
							Publish now
						</Button>

						<Button
							variant="ghost"
							size="sm"
							onClick={() => onCancel?.(post.id)}
							title="Cancel post"
							className="text-danger hover:bg-danger-soft"
						>
							<XCircle className="size-3.5" />
							Cancel
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
