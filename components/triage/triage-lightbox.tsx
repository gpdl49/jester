"use client";

import {
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	X,
	XCircle,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { TriageCandidateDto } from "@/lib/api/types";

export type TriageLightboxProps = {
	/** The candidate to show; the lightbox is closed while this is null. */
	candidate: TriageCandidateDto | null;
	position: number;
	total: number;
	canDecide: boolean;
	onClose: () => void;
	/** Called once closed, to put keyboard focus back on the page. */
	onRestoreFocus: () => void;
	onNext: () => void;
	onPrev: () => void;
	onAccept: () => void;
	onReject: () => void;
	/** Shown inside the dialog: the page behind it can't be clicked. */
	undoBanner?: ReactNode;
};

/** Full-window view of one candidate: the whole image, uncropped. */
export function TriageLightbox({
	candidate,
	position,
	total,
	canDecide,
	onClose,
	onRestoreFocus,
	onNext,
	onPrev,
	onAccept,
	onReject,
	undoBanner,
}: TriageLightboxProps) {
	const contentRef = useRef<HTMLDivElement | null>(null);

	return (
		<D.Root
			open={candidate !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			{candidate && (
				<D.Portal>
					<D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
					<D.Content
						ref={contentRef}
						// Focus the dialog rather than its first button, so a stray
						// Enter or Space can't press anything.
						onOpenAutoFocus={(e) => {
							e.preventDefault();
							contentRef.current?.focus();
						}}
						onCloseAutoFocus={(e) => {
							e.preventDefault();
							onRestoreFocus();
						}}
						className="fixed inset-0 z-50 flex flex-col bg-raised pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl outline-none sm:inset-4 sm:rounded-2xl sm:border sm:border-line sm:p-0"
					>
						<div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
							<div className="min-w-0">
								<D.Title className="truncate text-sm font-semibold">
									{candidate.originalFileName}
								</D.Title>
								<p className="text-xs text-muted">
									{position} of {total}
									{candidate.memeProbability !== null &&
										` · ${Math.round(candidate.memeProbability * 100)}%`}
									{candidate.width !== null &&
										candidate.height !== null &&
										` · ${candidate.width} × ${candidate.height}`}
								</p>
							</div>
							<D.Close asChild>
								<Button variant="ghost" size="icon" aria-label="Close">
									<X />
								</Button>
							</D.Close>
						</div>

						{/* Keyed so a new candidate never shows the previous image or zoom. */}
						<ZoomableImage key={candidate.id} candidate={candidate} />

						<div className="flex flex-col gap-2 border-t border-line px-4 py-2">
							<D.Description className="line-clamp-3 text-xs text-muted">
								{candidate.triageResult
									? `[${candidate.triageResult.kind}] ${candidate.triageResult.reason}`
									: candidate.error
										? `Error: ${candidate.error}`
										: "Not yet triaged"}
							</D.Description>
							{undoBanner}
							<div className="flex items-center justify-between gap-2">
								<div className="flex gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label="Previous image"
										disabled={position <= 1}
										onClick={onPrev}
									>
										<ChevronLeft />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Next image"
										disabled={position >= total}
										onClick={onNext}
									>
										<ChevronRight />
									</Button>
								</div>
								{canDecide && (
									<div className="flex gap-2">
										<Button variant="danger-ghost" onClick={onReject}>
											<XCircle />
											Reject
										</Button>
										<Button variant="primary" onClick={onAccept}>
											<CheckCircle2 />
											Accept
										</Button>
									</div>
								)}
							</div>
						</div>
					</D.Content>
				</D.Portal>
			)}
		</D.Root>
	);
}

/** Fits the image to the window; a click shows it enlarged and scrollable. */
function ZoomableImage({ candidate }: { candidate: TriageCandidateDto }) {
	const [zoomed, setZoomed] = useState(false);

	return (
		<div className="flex min-h-0 flex-1 overflow-auto bg-sunken">
			<button
				type="button"
				aria-label={zoomed ? "Fit image to window" : "Zoom in"}
				onClick={() => setZoomed((z) => !z)}
				className={cn(
					"m-auto block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
					zoomed
						? "min-w-full shrink-0 cursor-zoom-out"
						: "size-full cursor-zoom-in",
				)}
			>
				{/* biome-ignore lint/performance/noImgElement: same proxied previewUrl as the cards */}
				<img
					src={candidate.previewUrl}
					alt={candidate.originalFileName}
					draggable={false}
					className={
						zoomed
							? "block h-auto max-w-none min-w-full"
							: "block size-full object-contain"
					}
				/>
			</button>
		</div>
	);
}
