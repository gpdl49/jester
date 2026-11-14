"use client";

import { Check, CheckCircle2, SlidersHorizontal, XCircle } from "lucide-react";
import { Slider } from "radix-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import type { TriageStatus } from "@/lib/api/types";

export type TriageToolbarProps = {
	currentStatus: TriageStatus;
	onStatusChange: (status: TriageStatus) => void;
	selectedCount: number;
	onAcceptSelected: () => void;
	onRejectSelected: () => void;
	onClearSelection: () => void;
	isAdmin: boolean;
	onAcceptAbove: (minProbability: number) => Promise<unknown> | unknown;
	matchingAboveCount?: number;
};

const TABS: { label: string; status: TriageStatus }[] = [
	{ label: "To Review", status: "scored" },
	{ label: "Pending", status: "pending" },
	{ label: "Accepted", status: "accepted" },
	{ label: "Rejected", status: "rejected" },
	{ label: "Errors", status: "error" },
];

export function TriageToolbar({
	currentStatus,
	onStatusChange,
	selectedCount,
	onAcceptSelected,
	onRejectSelected,
	onClearSelection,
	isAdmin,
	onAcceptAbove,
	matchingAboveCount,
}: TriageToolbarProps) {
	const [threshold, setThreshold] = useState(0.8);

	const percent = Math.round(threshold * 100);

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between shadow-xs">
			{/* Status Tabs */}
			<div className="flex flex-wrap items-center gap-1">
				{TABS.map((tab) => {
					const isActive = currentStatus === tab.status;
					return (
						<button
							key={tab.status}
							type="button"
							onClick={() => onStatusChange(tab.status)}
							className={`rounded-lg px-3 py-1.5 text-xs font-medium transition outline-none ${
								isActive
									? "bg-accent text-accent-fg shadow-xs"
									: "text-muted hover:bg-sunken hover:text-fg"
							}`}
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			{/* Actions on the right */}
			<div className="flex flex-wrap items-center gap-2">
				{/* Selection actions */}
				{selectedCount > 0 && (
					<div className="flex items-center gap-1.5 border-r border-line pr-2 mr-1">
						<span className="text-xs font-semibold text-fg">
							{selectedCount} selected
						</span>
						{currentStatus === "scored" ||
						currentStatus === "pending" ||
						currentStatus === "error" ? (
							<>
								<Button
									size="sm"
									variant="primary"
									onClick={onAcceptSelected}
									className="h-8 px-2 text-xs"
								>
									<CheckCircle2 className="size-3.5 mr-1" />
									Accept (A)
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={onRejectSelected}
									className="h-8 px-2 text-xs text-danger hover:bg-danger/10"
								>
									<XCircle className="size-3.5 mr-1" />
									Reject (R)
								</Button>
							</>
						) : null}
						<Button
							size="sm"
							variant="ghost"
							onClick={onClearSelection}
							className="h-8 px-2 text-xs text-muted"
						>
							Clear
						</Button>
					</div>
				)}

				{/* Admin Accept All Above Slider & Button */}
				{isAdmin && currentStatus === "scored" && (
					<div className="flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-1.5">
						<SlidersHorizontal className="size-3.5 text-muted" />
						<div className="flex items-center gap-2">
							<span className="text-xs font-medium text-muted">
								≥ {percent}%
							</span>
							<Slider.Root
								value={[threshold]}
								onValueChange={([val]) => {
									if (val !== undefined) setThreshold(val);
								}}
								min={0.5}
								max={1.0}
								step={0.05}
								aria-label="Accept threshold"
								className="relative flex h-5 w-24 touch-none select-none items-center"
							>
								<Slider.Track className="relative h-1.5 w-full grow rounded-full bg-line">
									<Slider.Range className="absolute h-full rounded-full bg-accent" />
								</Slider.Track>
								<Slider.Thumb className="block size-4 rounded-full border border-line bg-surface shadow-xs transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent outline-none" />
							</Slider.Root>
						</div>

						<ConfirmDialog
							trigger={
								<Button
									size="sm"
									variant="secondary"
									className="h-7 px-2 text-xs"
								>
									<Check className="size-3 mr-1" />
									Accept all ≥ {percent}%
								</Button>
							}
							title={`Accept all candidates with score ≥ ${percent}%?`}
							description={
								matchingAboveCount !== undefined
									? `This will accept ${matchingAboveCount} candidate(s) scored at or above ${percent}% and enqueue them for import.`
									: `This will accept all candidates scored at or above ${percent}% and enqueue them for import.`
							}
							confirmLabel={`Accept all ≥ ${percent}%`}
							onConfirm={() => onAcceptAbove(threshold)}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
