"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import type { MemeSummaryDto } from "@/lib/api/types";
import { BlurhashImage } from "./blurhash-image";

export function MemeCard({
	meme,
	selected,
	onToggleSelect,
}: {
	meme: MemeSummaryDto;
	selected: boolean;
	onToggleSelect: (id: string, shiftKey: boolean) => void;
}) {
	const hasSensitivity = Boolean(
		meme.sensitivity &&
			(meme.sensitivity.nsfw ||
				meme.sensitivity.politics ||
				meme.sensitivity.slurs ||
				meme.sensitivity.personalData),
	);

	const sensitivityFlags = meme.sensitivity
		? [
				meme.sensitivity.nsfw && "NSFW",
				meme.sensitivity.politics && "Politics",
				meme.sensitivity.slurs && "Slurs",
				meme.sensitivity.personalData && "Personal Data",
			]
				.filter(Boolean)
				.join(", ")
		: "";

	return (
		<div
			className={cn(
				"group relative mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-surface transition-all duration-200",
				selected
					? "border-accent ring-2 ring-accent/30 shadow-md"
					: "border-line hover:border-line-strong hover:shadow-sm",
			)}
		>
			<Link href={`/memes/${meme.id}`} className="block">
				<BlurhashImage
					src={meme.thumbUrl}
					alt={meme.description || meme.template || "Meme"}
					blurhash={meme.blurhash}
					width={meme.width}
					height={meme.height}
					className="w-full"
				/>
			</Link>

			{/* Selection Checkbox */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggleSelect(meme.id, e.shiftKey);
				}}
				aria-label={`Select meme ${meme.id}`}
				className={cn(
					"absolute top-2.5 left-2.5 z-10 flex size-6 items-center justify-center rounded-md border shadow-xs transition-opacity duration-150",
					selected
						? "border-accent bg-accent text-accent-fg opacity-100"
						: "border-line/80 bg-canvas/80 text-transparent opacity-0 backdrop-blur-xs group-hover:opacity-100 hover:border-fg/40",
				)}
			>
				<svg
					className="size-3.5 fill-current stroke-current"
					viewBox="0 0 12 12"
					aria-hidden="true"
				>
					<path
						d="M3.5 6.5l2 2 3.5-5"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			</button>

			{/* Top-Right Badges */}
			<div className="pointer-events-none absolute top-2.5 right-2.5 flex items-center gap-1.5">
				{/* Postability Badge */}
				{meme.postability !== null && (
					<span
						className={cn(
							"rounded-md px-1.5 py-0.5 text-xs font-bold tracking-tight shadow-xs backdrop-blur-md",
							meme.postability >= 75
								? "bg-emerald-600/90 text-white"
								: meme.postability >= 50
									? "bg-amber-600/90 text-white"
									: "bg-neutral-800/80 text-neutral-300",
						)}
						title={`Postability: ${meme.postability}/100`}
					>
						{meme.postability}
					</span>
				)}

				{/* Attribution Badge */}
				{meme.hasAttribution && (
					<span
						className="flex size-6 items-center justify-center rounded-md bg-emerald-600/90 text-white shadow-xs backdrop-blur-md"
						title="Attribution confirmed"
					>
						<CheckCircle2 className="size-3.5" />
					</span>
				)}

				{/* Sensitivity Warning Icon */}
				{hasSensitivity && (
					<span
						className="flex size-6 items-center justify-center rounded-md bg-rose-600/90 text-white shadow-xs backdrop-blur-md"
						title={`Sensitive content: ${sensitivityFlags}`}
					>
						<AlertTriangle className="size-3.5" />
					</span>
				)}
			</div>

			{/* Bottom Bar: Status / Details */}
			<div className="flex items-center justify-between border-t border-line/50 p-2.5 text-xs">
				<div className="flex items-center gap-1.5 truncate">
					<span
						className={cn(
							"rounded-full px-2 py-0.5 font-medium uppercase tracking-wider text-[10px]",
							meme.status === "approved"
								? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
								: meme.status === "inbox"
									? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
									: meme.status === "archived"
										? "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400"
										: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
						)}
					>
						{meme.status}
					</span>

					{meme.postStatus && (
						<span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-medium text-[10px] text-violet-600 dark:text-violet-400">
							Post: {meme.postStatus}
						</span>
					)}
				</div>

				{meme.rating && (
					<span className="shrink-0 text-amber-500 font-medium">
						{"★".repeat(meme.rating)}
					</span>
				)}
			</div>
		</div>
	);
}
