"use client";

import type { MemeDetailDto } from "@/lib/api/types";

/**
 * Placeholder slot for the AttributionPanel owned by the `attribution` slice
 * (`components/attribution/attribution-panel.tsx`).
 * TODO: Replace with AttributionPanel once the attribution slice is merged.
 */
export function AttributionSlot({ meme }: { meme: MemeDetailDto }) {
	return (
		<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-fg">Attribution</h3>
				{meme.hasAttribution && (
					<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
						Confirmed
					</span>
				)}
			</div>
			<p className="mt-2 text-xs text-muted">
				{meme.creditText
					? `Credit: ${meme.creditText}`
					: "Attribution panel will be rendered here by the attribution slice."}
			</p>
			{meme.candidates.length > 0 && (
				<div className="mt-3 space-y-1.5 border-t border-line pt-2">
					<p className="text-xs font-medium text-faint">Candidates:</p>
					<ul className="space-y-1 text-xs">
						{meme.candidates.map((candidate) => (
							<li
								key={candidate.id}
								className="flex items-center justify-between"
							>
								<span className="truncate text-fg">
									{candidate.creatorName ||
										candidate.handle ||
										candidate.platform}
								</span>
								{candidate.url && (
									<a
										href={candidate.url}
										target="_blank"
										rel="noreferrer"
										className="ml-2 shrink-0 text-accent hover:underline"
									>
										View
									</a>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
