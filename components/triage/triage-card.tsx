"use client";

import { Check, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { TriageCandidateDto } from "@/lib/api/types";

export type TriageCardProps = {
	candidate: TriageCandidateDto;
	index: number;
	isFocused: boolean;
	isSelected: boolean;
	isAdmin?: boolean;
	canDecide?: boolean;
	onFocus: (index: number) => void;
	onToggleSelect: (id: string) => void;
	onShiftClick: (index: number) => void;
	onAccept: (id: string) => void;
	onReject: (id: string) => void;
	onReset?: (id: string) => void;
};

export function TriageCard({
	candidate,
	index,
	isFocused,
	isSelected,
	isAdmin,
	canDecide = true,
	onFocus,
	onToggleSelect,
	onShiftClick,
	onAccept,
	onReject,
	onReset,
}: TriageCardProps) {
	const probability = candidate.memeProbability;
	const percent =
		probability !== null ? `${Math.round(probability * 100)}%` : null;

	const badgeColor =
		probability === null
			? "bg-sunken text-muted"
			: probability >= 0.8
				? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
				: probability >= 0.5
					? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
					: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30";

	const reasonText = candidate.triageResult
		? `[${candidate.triageResult.kind}] ${candidate.triageResult.reason}`
		: candidate.error
			? `Error: ${candidate.error}`
			: "Not yet triaged";

	const formattedDate = candidate.fileCreatedAt
		? new Date(candidate.fileCreatedAt).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: null;

	function handleClick(e: MouseEvent) {
		if (e.shiftKey) {
			onShiftClick(index);
		} else {
			onFocus(index);
		}
	}

	return (
		<li
			data-testid={`triage-card-${candidate.id}`}
			data-card-id={candidate.id}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleClick(e as unknown as MouseEvent);
				}
			}}
			onFocus={() => onFocus(index)}
			className={cn(
				"group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs transition outline-none select-none list-none",
				isFocused && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
				isSelected && "border-accent bg-accent/5",
			)}
		>
			{/* Preview Image Container */}
			<div className="relative aspect-square w-full overflow-hidden bg-sunken">
				{/* biome-ignore lint/performance/noImgElement: contract specifies lazy-loaded <img> from previewUrl */}
				<img
					src={candidate.previewUrl}
					alt={candidate.originalFileName}
					loading="lazy"
					draggable={false}
					className="size-full object-cover transition duration-200 group-hover:scale-102"
				/>

				{/* Checkbox button */}
				<button
					type="button"
					aria-label={isSelected ? "Deselect item" : "Select item"}
					onClick={(e) => {
						e.stopPropagation();
						onToggleSelect(candidate.id);
					}}
					className={cn(
						"absolute top-2 left-2 flex size-7 items-center justify-center rounded-lg border border-line backdrop-blur-xs transition shadow-xs",
						isSelected
							? "border-accent bg-accent text-accent-fg"
							: "bg-surface/80 text-transparent hover:text-muted",
					)}
				>
					<Check className="size-4 stroke-[3]" />
				</button>

				{/* Probability Badge */}
				{percent && (
					<div
						className={cn(
							"absolute top-2 right-2 rounded-md px-2 py-0.5 text-xs font-semibold backdrop-blur-xs shadow-xs",
							badgeColor,
						)}
					>
						{percent}
					</div>
				)}

				{/* Model Reason Tooltip Overlay on hover/focus */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 max-h-full translate-y-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-2.5 text-xs text-white opacity-0 backdrop-blur-[1px] transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
					<p className="line-clamp-3 leading-snug">{reasonText}</p>
				</div>
			</div>

			{/* Card Footer / Metadata */}
			<div className="flex flex-col gap-1 p-2.5">
				<p
					title={candidate.originalFileName}
					className="truncate text-xs font-medium text-fg"
				>
					{candidate.originalFileName}
				</p>
				<div className="flex items-center justify-between text-[11px] text-muted">
					<span>{formattedDate ?? "Unknown date"}</span>
					{candidate.triageResult && (
						<span className="capitalize">{candidate.triageResult.kind}</span>
					)}
				</div>

				{/* Quick Actions */}
				<div className="mt-1 flex items-center justify-end gap-1.5 pt-1 border-t border-line/60">
					{canDecide ? (
						<>
							<Button
								size="sm"
								variant="ghost"
								aria-label="Reject candidate"
								className="h-7 px-2 text-xs text-danger hover:bg-danger/10"
								onClick={(e) => {
									e.stopPropagation();
									onReject(candidate.id);
								}}
							>
								<XCircle className="size-3.5 mr-1" />
								Reject
							</Button>
							<Button
								size="sm"
								variant="primary"
								aria-label="Accept candidate"
								className="h-7 px-2 text-xs"
								onClick={(e) => {
									e.stopPropagation();
									onAccept(candidate.id);
								}}
							>
								<CheckCircle2 className="size-3.5 mr-1" />
								Accept
							</Button>
						</>
					) : (
						isAdmin &&
						onReset && (
							<Button
								size="sm"
								variant="secondary"
								aria-label="Reset candidate"
								className="h-7 px-2 text-xs"
								onClick={(e) => {
									e.stopPropagation();
									onReset(candidate.id);
								}}
							>
								<RotateCcw className="size-3.5 mr-1" />
								Reset
							</Button>
						)
					)}
				</div>
			</div>
		</li>
	);
}
