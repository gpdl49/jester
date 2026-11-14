"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Camera,
	Check,
	ExternalLink,
	Globe,
	Loader2,
	RotateCw,
	Sparkles,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type {
	AttributionCandidateDto,
	AttributionPlatform,
	MemeDetailDto,
} from "@/lib/api/types";
import { api } from "@/lib/client/api";
import {
	useConfirmAttribution,
	useRejectAttribution,
	useRequestAttribution,
	useUpdateCreditText,
} from "@/lib/client/attribution";
import { queryKeys } from "@/lib/client/queries";

export function PlatformIcon({
	platform,
}: {
	platform: AttributionPlatform | string;
}) {
	switch (platform.toLowerCase()) {
		case "instagram":
			return <Camera className="size-4 text-pink-500" aria-label="Instagram" />;
		case "x":
			return (
				<span className="font-bold text-xs" role="img" aria-label="X">
					𝕏
				</span>
			);
		case "reddit":
			return (
				<span
					className="font-bold text-orange-500 text-xs"
					role="img"
					aria-label="Reddit"
				>
					r/
				</span>
			);
		default:
			return <Globe className="size-4 text-muted" aria-label={platform} />;
	}
}

export function AttributionPanel({
	meme: initialMeme,
}: {
	meme: MemeDetailDto;
}) {
	// Poll while attribution analysis is queued or running
	const { data: meme = initialMeme } = useQuery({
		queryKey: queryKeys.meme(initialMeme.id),
		queryFn: () => api.get<MemeDetailDto>(`/memes/${api.enc(initialMeme.id)}`),
		initialData: initialMeme,
		refetchInterval: (query) => {
			const m = query.state.data ?? initialMeme;
			const isSearching = m.analyses?.some(
				(a) =>
					a.kind === "attribution" &&
					(a.status === "queued" || a.status === "running"),
			);
			return isSearching ? 2000 : false;
		},
	});

	const requestMutation = useRequestAttribution();
	const confirmMutation = useConfirmAttribution();
	const rejectMutation = useRejectAttribution();
	const updateCreditMutation = useUpdateCreditText();

	const [creditInput, setCreditInput] = useState(meme.creditText ?? "");

	useEffect(() => {
		setCreditInput(meme.creditText ?? "");
	}, [meme.creditText]);

	const isSearching =
		requestMutation.isPending ||
		meme.analyses?.some(
			(a) =>
				a.kind === "attribution" &&
				(a.status === "queued" || a.status === "running"),
		);

	const hasCandidates = meme.candidates && meme.candidates.length > 0;
	const hasAttributionAnalysis = meme.analyses?.some(
		(a) => a.kind === "attribution",
	);

	const handleSearch = () => {
		requestMutation.mutate(meme.id);
	};

	const handleSaveCredit = (e: FormEvent) => {
		e.preventDefault();
		updateCreditMutation.mutate({
			memeId: meme.id,
			creditText: creditInput,
		});
	};

	return (
		<div className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-5">
			<div className="flex items-center justify-between border-b border-line pb-4">
				<div className="flex items-center gap-2">
					<Sparkles className="size-5 text-accent" />
					<h3 className="font-semibold text-fg text-lg">Attribution</h3>
				</div>
				<Button
					variant="secondary"
					size="sm"
					onClick={handleSearch}
					disabled={isSearching}
					aria-label={
						hasCandidates || hasAttributionAnalysis
							? "Search again"
							: "Find creator"
					}
				>
					{isSearching ? (
						<>
							<Loader2 className="size-4 animate-spin" />
							<span>Searching...</span>
						</>
					) : hasCandidates || hasAttributionAnalysis ? (
						<>
							<RotateCw className="size-4" />
							<span>Search again</span>
						</>
					) : (
						<>
							<Sparkles className="size-4" />
							<span>Find creator</span>
						</>
					)}
				</Button>
			</div>

			{/* Running indicator */}
			{isSearching && (
				<div
					data-testid="searching-indicator"
					className="flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/10 p-3.5 text-accent text-sm"
				>
					<Loader2 className="size-5 animate-spin shrink-0" />
					<div>
						<p className="font-medium">
							Searching the web for the original creator
						</p>
						<p className="text-xs text-muted">
							Checking image matches, OCR text, handles, and watermarks...
						</p>
					</div>
				</div>
			)}

			{/* Candidates list */}
			<div className="flex flex-col gap-3">
				<h4 className="font-medium text-muted text-xs uppercase tracking-wider">
					Candidates {hasCandidates ? `(${meme.candidates.length})` : ""}
				</h4>

				{!hasCandidates && !isSearching && (
					<div className="rounded-lg border border-dashed border-line p-6 text-center text-faint text-sm">
						No attribution candidates found yet. Click &quot;Find creator&quot;
						to search the web.
					</div>
				)}

				{meme.candidates?.map((candidate: AttributionCandidateDto) => {
					const isConfirmed = meme.attribution?.id === candidate.id;
					const isRejected = Boolean(candidate.rejectedAt);
					const confidencePercent = Math.round(candidate.confidence * 100);

					return (
						<div
							key={candidate.id}
							data-testid={`candidate-${candidate.id}`}
							className={`flex flex-col gap-2 rounded-lg border p-4 transition ${
								isConfirmed
									? "border-accent bg-accent/5 ring-1 ring-accent"
									: isRejected
										? "border-line bg-sunken/40 opacity-60"
										: "border-line bg-surface hover:border-muted"
							}`}
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex items-center gap-2">
									<PlatformIcon platform={candidate.platform} />
									<span className="font-medium text-fg text-sm">
										{candidate.handle
											? `@${candidate.handle}`
											: candidate.creatorName || "Unknown creator"}
									</span>
									{candidate.creatorName && candidate.handle && (
										<span className="text-muted text-xs">
											({candidate.creatorName})
										</span>
									)}
								</div>

								<div className="flex items-center gap-2">
									{isConfirmed && (
										<span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-accent text-xs">
											<Check className="size-3" /> Confirmed
										</span>
									)}
									{isRejected && (
										<span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 font-medium text-danger text-xs">
											<X className="size-3" /> Rejected
										</span>
									)}
									<span className="font-mono text-muted text-xs">
										{confidencePercent}%
									</span>
								</div>
							</div>

							{/* Confidence progress bar */}
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
								<div
									className={`h-full transition-all ${
										confidencePercent > 70
											? "bg-accent"
											: confidencePercent > 40
												? "bg-amber-500"
												: "bg-muted"
									}`}
									style={{ width: `${confidencePercent}%` }}
								/>
							</div>

							{/* Evidence */}
							<p className="text-muted text-xs leading-relaxed">
								{candidate.evidence}
							</p>

							{/* Link and action buttons */}
							<div className="mt-1 flex items-center justify-between gap-2 border-t border-line/60 pt-2">
								{candidate.url ? (
									<a
										href={candidate.url}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-accent text-xs hover:underline"
									>
										<span>View source</span>
										<ExternalLink className="size-3" />
									</a>
								) : (
									<span className="text-faint text-xs">No direct link</span>
								)}

								<div className="flex items-center gap-1.5">
									{!isConfirmed && (
										<Button
											variant="secondary"
											size="sm"
											onClick={() =>
												confirmMutation.mutate({
													memeId: meme.id,
													candidateId: candidate.id,
												})
											}
											disabled={confirmMutation.isPending}
											aria-label={`Confirm candidate ${candidate.handle || candidate.id}`}
										>
											<Check className="size-3.5" />
											<span>Confirm</span>
										</Button>
									)}

									{!isRejected && (
										<Button
											variant="danger-ghost"
											size="sm"
											onClick={() =>
												rejectMutation.mutate({
													memeId: meme.id,
													candidateId: candidate.id,
												})
											}
											disabled={rejectMutation.isPending}
											aria-label={`Reject candidate ${candidate.handle || candidate.id}`}
										>
											<X className="size-3.5" />
											<span>Reject</span>
										</Button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Editable credit text */}
			<form
				onSubmit={handleSaveCredit}
				className="flex flex-col gap-3 border-t border-line pt-4"
			>
				<Field
					label="Credit text"
					hint="Included in the Instagram post caption (📸 @handle on Platform)"
				>
					<div className="flex gap-2">
						<Input
							value={creditInput}
							onChange={(e) => setCreditInput(e.target.value)}
							placeholder="e.g. @artist on Instagram"
							aria-label="Credit text"
						/>
						<Button
							type="submit"
							variant="secondary"
							size="md"
							disabled={
								updateCreditMutation.isPending ||
								creditInput === (meme.creditText ?? "")
							}
						>
							{updateCreditMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</Field>
			</form>
		</div>
	);
}
