"use client";

import {
	ArrowLeft,
	Check,
	ExternalLink,
	Plus,
	RotateCw,
	Sparkles,
	Star,
	Trash2,
	X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AttributionPanel } from "@/components/attribution/attribution-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, Loading } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import type { PostDetailDto } from "@/lib/api/types";
import { api } from "@/lib/client/api";
import {
	useBulkMemes,
	useDeleteMeme,
	useMeme,
	usePatchMeme,
} from "@/lib/client/memes";

export function MemeDetail({ id }: { id: string }) {
	const router = useRouter();
	const { data: meme, isLoading, error } = useMeme(id);
	const {
		mutate: patch,
		isPending: isPatching,
		error: patchError,
	} = usePatchMeme();
	const { mutate: deleteThisMeme, isPending: isDeleting } = useDeleteMeme();
	const {
		mutate: runBulk,
		isPending: isAnalyzing,
		error: analyzeError,
	} = useBulkMemes();

	// Local state for editable fields
	const [description, setDescription] = useState("");
	const [altText, setAltText] = useState("");
	const [captionDraft, setCaptionDraft] = useState("");
	const [hashtags, setHashtags] = useState("");
	const [template, setTemplate] = useState("");
	const [notes, setNotes] = useState("");
	const [newTagName, setNewTagName] = useState("");
	const [isAddingToPost, setIsAddingToPost] = useState(false);
	const [postError, setPostError] = useState<string | null>(null);

	// Sync local state when meme loads or updates
	useEffect(() => {
		if (meme) {
			setDescription(meme.description ?? "");
			setAltText(meme.altText ?? "");
			setCaptionDraft(meme.captionDraft ?? "");
			setHashtags(meme.hashtags.join(", "));
			setTemplate(meme.template ?? "");
			setNotes(meme.notes ?? "");
		}
	}, [meme]);

	// Keyboard shortcuts: ←/→, 'a' (approve), 'r' (reject)
	useEffect(() => {
		if (!meme) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			// Never hijack browser shortcuts (Cmd/Ctrl+R reloads, Cmd/Ctrl+A selects)
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
			if (
				tag === "input" ||
				tag === "textarea" ||
				tag === "select" ||
				(e.target as HTMLElement)?.isContentEditable
			) {
				return;
			}

			if (e.key === "a") {
				e.preventDefault();
				patch({ id: meme.id, patch: { status: "approved" } });
			} else if (e.key === "r") {
				e.preventDefault();
				patch({ id: meme.id, patch: { status: "rejected" } });
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [meme, patch]);

	if (isLoading) return <Loading label="Loading meme…" />;
	if (error || !meme) {
		return (
			<EmptyState
				title="Meme not found"
				action={
					<Button variant="secondary" onClick={() => router.push("/memes")}>
						Back to Library
					</Button>
				}
			>
				{error instanceof Error
					? error.message
					: "The requested meme does not exist."}
			</EmptyState>
		);
	}

	const isUserEdited = (field: string) => meme.userEdited.includes(field);

	const handleSaveField = (
		field:
			| "description"
			| "altText"
			| "captionDraft"
			| "hashtags"
			| "template"
			| "notes",
	) => {
		let value: unknown;
		if (field === "hashtags") {
			value = hashtags
				.split(",")
				.map((h) => h.trim().replace(/^#/, ""))
				.filter(Boolean);
		} else if (field === "notes") {
			value = notes.trim() || null;
		} else if (field === "description") {
			value = description.trim() || null;
		} else if (field === "altText") {
			value = altText.trim() || null;
		} else if (field === "captionDraft") {
			value = captionDraft.trim() || null;
		} else if (field === "template") {
			value = template.trim() || null;
		}

		const current = meme[field];
		const unchanged = Array.isArray(value)
			? Array.isArray(current) &&
				value.length === current.length &&
				value.every((v, i) => v === current[i])
			: (value ?? null) === (current ?? null);
		if (unchanged) return; // blur without an edit must not mark the field user-edited
		patch({ id: meme.id, patch: { [field]: value } });
	};

	const handleAddTag = (e: React.FormEvent) => {
		e.preventDefault();
		if (!newTagName.trim()) return;
		const currentTags = meme.tags.map((t) => t.name);
		const tagToAppend = newTagName.trim().toLowerCase();
		if (!currentTags.includes(tagToAppend)) {
			patch(
				{
					id: meme.id,
					patch: { tags: [...currentTags, tagToAppend] },
				},
				{ onSuccess: () => setNewTagName("") },
			);
		} else {
			setNewTagName("");
		}
	};

	const handleRemoveTag = (tagName: string) => {
		const nextTags = meme.tags
			.filter((t) => t.name !== tagName)
			.map((t) => t.name);
		patch({ id: meme.id, patch: { tags: nextTags } });
	};

	const handleRating = (stars: number) => {
		const newRating = meme.rating === stars ? null : stars;
		patch({ id: meme.id, patch: { rating: newRating } });
	};

	const handleAddToPost = async () => {
		setIsAddingToPost(true);
		setPostError(null);
		try {
			const post = await api.post<PostDetailDto>("/posts", {
				memeIds: [meme.id],
				status: "draft",
			});
			router.push(`/posts/${post.id}`);
		} catch (err) {
			setPostError(
				err instanceof Error ? err.message : "Failed to create post",
			);
			setIsAddingToPost(false);
		}
	};

	const handleDelete = () => {
		if (
			window.confirm("Are you sure you want to permanently delete this meme?")
		) {
			deleteThisMeme(meme.id, {
				onSuccess: () => router.push("/memes"),
			});
		}
	};

	const handleRerunAnalysis = () => {
		runBulk({ ids: [meme.id], action: "analyze" });
	};

	return (
		<div className="pb-24">
			{/* Top Bar Navigation & Actions */}
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
				<div className="flex items-center gap-3">
					<Link
						href="/memes"
						className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
					>
						<ArrowLeft className="size-4" />
						Library
					</Link>
					<span
						className={cn(
							"rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
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
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant={meme.status === "approved" ? "primary" : "secondary"}
						disabled={isPatching}
						onClick={() =>
							patch({ id: meme.id, patch: { status: "approved" } })
						}
					>
						<Check className="size-3.5" />
						Approve (a)
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPatching}
						onClick={() =>
							patch({ id: meme.id, patch: { status: "rejected" } })
						}
					>
						<X className="size-3.5" />
						Reject (r)
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={isPatching}
						onClick={() =>
							patch({ id: meme.id, patch: { status: "archived" } })
						}
					>
						Archive
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={isAddingToPost}
						onClick={handleAddToPost}
					>
						<Plus className="size-3.5" />
						Add to post
					</Button>
					<Button
						size="sm"
						variant="danger-ghost"
						disabled={isDeleting}
						onClick={handleDelete}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</div>
			</div>

			{(patchError || analyzeError) && (
				<div
					role="alert"
					className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger"
				>
					{(patchError ?? analyzeError)?.message}
				</div>
			)}

			{postError && (
				<div className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">
					{postError}
				</div>
			)}

			<div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
				{/* Left Column: Large Image (Click opens original) */}
				<div className="lg:col-span-7 flex flex-col gap-4">
					<div className="overflow-hidden rounded-2xl border border-line bg-surface/30 shadow-md">
						<a
							href={meme.originalUrl}
							target="_blank"
							rel="noreferrer"
							title="Click to open original in new tab"
							className="group relative block cursor-zoom-in"
						>
							<Image
								src={meme.displayUrl}
								alt={meme.description || "Meme display"}
								width={meme.width ?? 1200}
								height={meme.height ?? 800}
								unoptimized
								className="w-full object-contain max-h-[75vh]"
							/>
							<div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg bg-canvas/80 px-2.5 py-1 text-xs font-medium text-fg shadow-xs backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity">
								<ExternalLink className="size-3.5" />
								Original
							</div>
						</a>
					</div>

					{/* Rating Bar */}
					<div className="flex items-center justify-between rounded-xl border border-line bg-surface p-3.5 shadow-xs">
						<span className="text-xs font-medium text-muted">
							Quality Rating
						</span>
						<div className="flex items-center gap-1">
							{[1, 2, 3, 4, 5].map((star) => (
								<button
									key={star}
									type="button"
									onClick={() => handleRating(star)}
									className="p-1 text-muted transition hover:text-amber-500 focus-visible:outline-none"
									title={`${star} stars`}
								>
									<Star
										className={cn(
											"size-5",
											meme.rating && meme.rating >= star
												? "fill-amber-500 text-amber-500"
												: "text-line-strong hover:fill-amber-500/20",
										)}
									/>
								</button>
							))}
						</div>
					</div>

					{/* Duplicates Section */}
					{(meme.duplicates.length > 0 || meme.duplicateOfId) && (
						<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
							<h3 className="text-sm font-semibold text-fg">Duplicates</h3>
							{meme.duplicateOfId && (
								<div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-canvas p-2.5 text-xs">
									<span className="text-muted">
										Duplicate of{" "}
										<Link
											href={`/memes/${meme.duplicateOfId}`}
											className="text-accent underline font-mono"
										>
											{meme.duplicateOfId.slice(0, 8)}…
										</Link>
									</span>
									<Button
										size="sm"
										variant="secondary"
										onClick={() =>
											patch({ id: meme.id, patch: { duplicateOfId: null } })
										}
									>
										Keep this (unlink)
									</Button>
								</div>
							)}
							{meme.duplicates.length > 0 && (
								<div className="mt-3 space-y-2">
									<p className="text-xs font-medium text-muted">
										Other memes marked as duplicate of this:
									</p>
									<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
										{meme.duplicates.map((dup) => (
											<div
												key={dup.id}
												className="relative overflow-hidden rounded-lg border border-line bg-canvas p-1.5"
											>
												<Link href={`/memes/${dup.id}`}>
													<Image
														src={dup.thumbUrl}
														alt="Duplicate thumbnail"
														width={200}
														height={150}
														unoptimized
														className="h-20 w-full object-cover rounded"
													/>
												</Link>
												<button
													type="button"
													onClick={() =>
														patch({
															id: dup.id,
															patch: { duplicateOfId: null },
														})
													}
													className="mt-1 w-full text-center text-[10px] text-muted hover:text-fg hover:underline"
												>
													Unlink
												</button>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{/* Analysis History & Re-run */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-fg">
								Analysis History
							</h3>
							<Button
								size="sm"
								variant="secondary"
								disabled={isAnalyzing}
								onClick={handleRerunAnalysis}
							>
								<RotateCw className="size-3.5" />
								Re-run Analysis
							</Button>
						</div>
						{meme.analyses.length === 0 ? (
							<p className="mt-2 text-xs text-muted">
								No analyses recorded yet.
							</p>
						) : (
							<ul className="mt-3 divide-y divide-line text-xs">
								{meme.analyses.map((analysis) => (
									<li key={analysis.id} className="py-2.5">
										<div className="flex items-center justify-between font-medium">
											<span className="capitalize text-fg">
												{analysis.kind} ({analysis.model || "default"})
											</span>
											<span
												className={cn(
													"rounded px-1.5 py-0.5 text-[10px]",
													analysis.status === "done"
														? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
														: analysis.status === "failed"
															? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
															: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
												)}
											>
												{analysis.status}
											</span>
										</div>
										<div className="mt-1 flex items-center justify-between text-faint text-[10px]">
											<span>
												{new Date(analysis.createdAt).toLocaleString()}
											</span>
											{analysis.costUsd !== null && (
												<span>${analysis.costUsd.toFixed(4)}</span>
											)}
										</div>
										{analysis.error && (
											<p className="mt-1 text-danger text-[11px]">
												{analysis.error}
											</p>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				{/* Right Column: Metadata, Tags, AI Fields, Sensitivity */}
				<div className="lg:col-span-5 flex flex-col gap-6">
					{/* Attribution */}
					<AttributionPanel meme={meme} />

					{/* Tags Section */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
						<h3 className="text-sm font-semibold text-fg">Tags</h3>
						<div className="mt-2.5 flex flex-wrap gap-1.5">
							{meme.tags.map((tag) => (
								<span
									key={tag.name}
									className={cn(
										"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
										tag.source === "user"
											? "bg-accent/10 text-accent border border-accent/20"
											: "bg-canvas text-muted border border-line",
									)}
								>
									#{tag.name}
									<span className="text-[10px] opacity-60">({tag.source})</span>
									{tag.source === "user" && (
										<button
											type="button"
											onClick={() => handleRemoveTag(tag.name)}
											className="ml-0.5 text-muted hover:text-fg"
											aria-label={`Remove tag ${tag.name}`}
										>
											<X className="size-3" />
										</button>
									)}
								</span>
							))}
						</div>

						<form onSubmit={handleAddTag} className="mt-3 flex gap-2">
							<Input
								type="text"
								placeholder="Add tag…"
								value={newTagName}
								onChange={(e) => setNewTagName(e.target.value)}
								className="h-8 text-xs"
							/>
							<Button type="submit" size="sm" variant="secondary">
								Add
							</Button>
						</form>
					</div>

					{/* Editable AI Fields */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
								<Sparkles className="size-4 text-accent" />
								AI Fields
							</h3>
							<span className="text-[11px] text-muted">
								Changes marked as edited
							</span>
						</div>

						{/* Description */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<label
									htmlFor="field-description"
									className="text-xs font-medium text-muted"
								>
									Description
								</label>
								{isUserEdited("description") && (
									<span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										edited
									</span>
								)}
							</div>
							<Textarea
								id="field-description"
								rows={2}
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								onBlur={() => handleSaveField("description")}
								className="text-xs min-h-16"
							/>
						</div>

						{/* Caption Draft */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<label
									htmlFor="field-caption"
									className="text-xs font-medium text-muted"
								>
									Caption Draft
								</label>
								{isUserEdited("captionDraft") && (
									<span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										edited
									</span>
								)}
							</div>
							<Textarea
								id="field-caption"
								rows={2}
								value={captionDraft}
								onChange={(e) => setCaptionDraft(e.target.value)}
								onBlur={() => handleSaveField("captionDraft")}
								className="text-xs min-h-16"
							/>
						</div>

						{/* Alt Text */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<label
									htmlFor="field-alttext"
									className="text-xs font-medium text-muted"
								>
									Alt Text
								</label>
								{isUserEdited("altText") && (
									<span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										edited
									</span>
								)}
							</div>
							<Input
								id="field-alttext"
								value={altText}
								onChange={(e) => setAltText(e.target.value)}
								onBlur={() => handleSaveField("altText")}
								className="h-8 text-xs"
							/>
						</div>

						{/* Template */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<label
									htmlFor="field-template"
									className="text-xs font-medium text-muted"
								>
									Template
								</label>
								{isUserEdited("template") && (
									<span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										edited
									</span>
								)}
							</div>
							<Input
								id="field-template"
								value={template}
								onChange={(e) => setTemplate(e.target.value)}
								onBlur={() => handleSaveField("template")}
								className="h-8 text-xs"
							/>
						</div>

						{/* Hashtags */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<label
									htmlFor="field-hashtags"
									className="text-xs font-medium text-muted"
								>
									Hashtags (comma separated)
								</label>
								{isUserEdited("hashtags") && (
									<span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										edited
									</span>
								)}
							</div>
							<Input
								id="field-hashtags"
								value={hashtags}
								onChange={(e) => setHashtags(e.target.value)}
								onBlur={() => handleSaveField("hashtags")}
								className="h-8 text-xs"
							/>
						</div>
					</div>

					{/* Notes */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
						<label
							htmlFor="field-notes"
							className="text-xs font-medium text-muted"
						>
							Notes
						</label>
						<Textarea
							id="field-notes"
							placeholder="Personal curation notes…"
							rows={2}
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							onBlur={() => handleSaveField("notes")}
							className="mt-1.5 text-xs min-h-16"
						/>
					</div>

					{/* Sensitivity & Quality Summary */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs flex flex-col gap-3">
						<h3 className="text-sm font-semibold text-fg">Quality & Safety</h3>
						<div className="grid grid-cols-2 gap-2 text-xs">
							<div className="flex items-center justify-between rounded border border-line bg-canvas p-2">
								<span className="text-muted">Postability</span>
								<span className="font-semibold text-fg">
									{meme.postability !== null ? `${meme.postability}/100` : "—"}
								</span>
							</div>
							<div className="flex items-center justify-between rounded border border-line bg-canvas p-2">
								<span className="text-muted">NSFW</span>
								<span
									className={
										meme.sensitivity?.nsfw
											? "font-bold text-rose-500"
											: "text-muted"
									}
								>
									{meme.sensitivity?.nsfw ? "Yes" : "No"}
								</span>
							</div>
							<div className="flex items-center justify-between rounded border border-line bg-canvas p-2">
								<span className="text-muted">Politics</span>
								<span
									className={
										meme.sensitivity?.politics
											? "font-bold text-rose-500"
											: "text-muted"
									}
								>
									{meme.sensitivity?.politics ? "Yes" : "No"}
								</span>
							</div>
							<div className="flex items-center justify-between rounded border border-line bg-canvas p-2">
								<span className="text-muted">Watermark</span>
								<span
									className={
										meme.quality?.watermark
											? "font-semibold text-amber-500"
											: "text-muted"
									}
								>
									{meme.quality?.watermark ? "Yes" : "No"}
								</span>
							</div>
						</div>
						{meme.sensitivity?.notes && (
							<p className="text-xs text-muted italic">
								Safety notes: {meme.sensitivity.notes}
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
