"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type TriageUndoBannerProps = {
	count: number;
	secondsRemaining: number;
	onUndo: () => void;
	onFlushNow?: () => void;
};

export function TriageUndoBanner({
	count,
	secondsRemaining,
	onUndo,
	onFlushNow,
}: TriageUndoBannerProps) {
	if (count <= 0) {
		return null;
	}

	return (
		<aside
			aria-label="Undo triage decision"
			className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-raised px-4 py-2.5 text-sm shadow-xl backdrop-blur-md"
		>
			<span className="text-fg font-medium">
				Decided {count} candidate{count === 1 ? "" : "s"}
			</span>
			<span className="text-xs text-muted">({secondsRemaining}s)</span>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					variant="secondary"
					onClick={onUndo}
					className="h-8 text-xs font-semibold"
				>
					<Undo2 className="size-3.5 mr-1" />
					Undo
				</Button>
				{onFlushNow && (
					<Button
						size="sm"
						variant="ghost"
						onClick={onFlushNow}
						className="h-8 text-xs text-muted hover:text-fg"
					>
						Apply now
					</Button>
				)}
			</div>
		</aside>
	);
}
