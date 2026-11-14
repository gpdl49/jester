"use client";

import {
	AlertCircle,
	CheckCircle2,
	ExternalLink,
	FileImage,
	RefreshCw,
	Trash2,
	UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/feedback";
import {
	completeUpload,
	createUpload,
	getUpload,
	uploadToPresignedUrl,
} from "@/lib/client/media";
import {
	initialUploadState,
	type UploadItem,
	uploadReducer,
} from "./upload-reducer";

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function UploadView() {
	const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
	const fileInputId = useId();
	const inFlightRef = useRef<Set<string>>(new Set());

	const handleFiles = useCallback((files: FileList | File[]) => {
		const arr = Array.from(files);
		if (arr.length > 0) {
			dispatch({ type: "ADD_FILES", files: arr });
		}
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent<HTMLLabelElement>) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer.files) {
				handleFiles(e.dataTransfer.files);
			}
		},
		[handleFiles],
	);

	const onDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	// Upload queue processor
	useEffect(() => {
		for (const item of state.items) {
			if (item.status === "queued" && !inFlightRef.current.has(item.id)) {
				inFlightRef.current.add(item.id);
				(async () => {
					try {
						// 1. Create upload on server
						const created = await createUpload({
							contentType: item.file.type,
							size: item.file.size,
						});

						dispatch({
							type: "START_UPLOAD",
							id: item.id,
							uploadId: created.upload.id,
						});

						// 2. PUT to presigned S3 URL
						await uploadToPresignedUrl(
							created.uploadUrl,
							created.uploadHeaders,
							item.file,
							(percent) => {
								dispatch({
									type: "SET_PROGRESS",
									id: item.id,
									progress: percent,
								});
							},
						);

						// 3. Mark complete on server
						dispatch({ type: "SET_COMPLETING", id: item.id });
						const completed = await completeUpload(created.upload.id);

						if (completed.status === "imported" && completed.memeId) {
							dispatch({
								type: "SET_IMPORTED",
								id: item.id,
								memeId: completed.memeId,
							});
							inFlightRef.current.delete(item.id);
							return;
						}

						dispatch({
							type: "SET_PROCESSING",
							id: item.id,
							memeId: completed.memeId ?? undefined,
						});

						// 4. Poll upload until imported or failed
						let attempts = 0;
						const pollInterval = setInterval(async () => {
							attempts++;
							try {
								const poll = await getUpload(created.upload.id);
								if (poll.status === "imported" && poll.memeId) {
									clearInterval(pollInterval);
									dispatch({
										type: "SET_IMPORTED",
										id: item.id,
										memeId: poll.memeId,
									});
									inFlightRef.current.delete(item.id);
								} else if (poll.status === "failed") {
									clearInterval(pollInterval);
									dispatch({
										type: "SET_ERROR",
										id: item.id,
										error: poll.error ?? "Import failed",
									});
									inFlightRef.current.delete(item.id);
								} else if (attempts > 60) {
									// 90 seconds timeout
									clearInterval(pollInterval);
									dispatch({
										type: "SET_ERROR",
										id: item.id,
										error: "Processing timed out",
									});
									inFlightRef.current.delete(item.id);
								}
							} catch {
								// ignore transient polling errors
							}
						}, 1500);
					} catch (err) {
						inFlightRef.current.delete(item.id);
						dispatch({
							type: "SET_ERROR",
							id: item.id,
							error: err instanceof Error ? err.message : "Upload failed",
						});
					}
				})();
			}
		}
	}, [state.items]);

	const hasFinished = state.items.some((i) => i.status === "imported");

	return (
		<div className="space-y-6">
			{/* Dropzone */}
			<label
				htmlFor={fileInputId}
				onDrop={onDrop}
				onDragOver={onDragOver}
				className={cn(
					"flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface p-8 text-center transition cursor-pointer",
					"hover:border-accent hover:bg-sunken focus-within:border-accent",
				)}
			>
				<input
					id={fileInputId}
					type="file"
					multiple
					accept="image/jpeg,image/png,image/webp,image/gif"
					className="sr-only"
					onChange={(e) => {
						if (e.target.files) {
							handleFiles(e.target.files);
							e.target.value = "";
						}
					}}
				/>
				<div className="flex size-14 items-center justify-center rounded-full bg-sunken text-accent">
					<UploadCloud className="size-7" />
				</div>
				<h2 className="mt-4 text-base font-medium text-fg">
					Click to upload or drag and drop
				</h2>
				<p className="mt-1 text-sm text-muted">
					JPEG, PNG, WebP or GIF up to 25 MiB each
				</p>
			</label>

			{/* Actions toolbar */}
			{state.items.length > 0 && (
				<div className="flex items-center justify-between">
					<div className="text-sm font-medium text-muted">
						{state.items.length} {state.items.length === 1 ? "file" : "files"}
					</div>
					{hasFinished && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => dispatch({ type: "CLEAR_FINISHED" })}
						>
							Clear completed
						</Button>
					)}
				</div>
			)}

			{/* Upload list */}
			{state.items.length > 0 && (
				<div className="divide-y divide-line rounded-lg border border-line bg-surface">
					{state.items.map((item) => (
						<UploadRow
							key={item.id}
							item={item}
							onRetry={() => dispatch({ type: "RETRY", id: item.id })}
							onRemove={() => dispatch({ type: "REMOVE", id: item.id })}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function UploadRow({
	item,
	onRetry,
	onRemove,
}: {
	item: UploadItem;
	onRetry: () => void;
	onRemove: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted">
					<FileImage className="size-5" />
				</div>
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-fg">
						{item.file.name}
					</p>
					<p className="text-xs text-muted">{formatFileSize(item.file.size)}</p>
				</div>
			</div>

			<div className="flex items-center gap-3 self-end sm:self-auto">
				{/* Status & Progress */}
				{item.status === "queued" && (
					<span className="text-xs text-muted">Queued…</span>
				)}

				{item.status === "uploading" && (
					<div className="flex items-center gap-2">
						<div className="h-2 w-24 overflow-hidden rounded-full bg-sunken">
							<div
								className="h-full bg-accent transition-all duration-150"
								style={{ width: `${item.progress}%` }}
							/>
						</div>
						<span className="text-xs tabular-nums text-muted">
							{item.progress}%
						</span>
					</div>
				)}

				{item.status === "completing" && (
					<span className="flex items-center gap-1.5 text-xs text-muted">
						<Spinner className="size-3.5" />
						Verifying…
					</span>
				)}

				{item.status === "processing" && (
					<span className="flex items-center gap-1.5 text-xs text-muted">
						<Spinner className="size-3.5" />
						Processing…
					</span>
				)}

				{item.status === "imported" && (
					<div className="flex items-center gap-2">
						<span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
							<CheckCircle2 className="size-4" />
							Imported
						</span>
						{item.memeId && (
							<Link
								href={`/memes/${item.memeId}`}
								className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
							>
								View Meme
								<ExternalLink className="size-3" />
							</Link>
						)}
					</div>
				)}

				{item.status === "error" && (
					<div className="flex items-center gap-2">
						<span
							className="flex items-center gap-1 text-xs text-danger"
							title={item.error}
						>
							<AlertCircle className="size-4 shrink-0" />
							<span className="max-w-[200px] truncate">
								{item.error ?? "Failed"}
							</span>
						</span>
						<Button
							variant="ghost"
							size="icon"
							onClick={onRetry}
							title="Retry upload"
							aria-label="Retry upload"
						>
							<RefreshCw className="size-4" />
						</Button>
					</div>
				)}

				{/* Remove item button */}
				<Button
					variant="ghost"
					size="icon"
					onClick={onRemove}
					title="Remove"
					aria-label="Remove"
				>
					<Trash2 className="size-4 text-muted hover:text-fg" />
				</Button>
			</div>
		</div>
	);
}
