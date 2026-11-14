"use client";

import { format } from "date-fns";
import {
	ArrowLeft,
	Calendar,
	Check,
	ExternalLink,
	Save,
	Send,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { PostItemDto } from "@/lib/api/types";
import {
	usePatchPost,
	usePost,
	usePublishNow,
	useScheduleSlots,
} from "@/lib/client/posts";
import { CaptionEditor } from "./caption-editor";
import { CarouselOrder } from "./carousel-order";
import { InstagramPreview } from "./instagram-preview";

export function PostDetailPage({ id }: { id: string }) {
	const { data: post, isLoading, error } = usePost(id);
	const { data: slots } = useScheduleSlots();

	const patchMutation = usePatchPost(id);
	const publishNowMutation = usePublishNow(id);

	const [caption, setCaption] = useState("");
	const [items, setItems] = useState<PostItemDto[]>([]);
	const [customDate, setCustomDate] = useState("");
	const [saveSuccess, setSaveSuccess] = useState(false);

	useEffect(() => {
		if (post) {
			setCaption(post.caption ?? "");
			setItems(post.items ?? []);
			if (post.scheduledAt) {
				// Format for datetime-local input YYYY-MM-DDTHH:mm
				const d = new Date(post.scheduledAt);
				const isoLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
					.toISOString()
					.slice(0, 16);
				setCustomDate(isoLocal);
			} else {
				setCustomDate("");
			}
		}
	}, [post]);

	if (isLoading) {
		return (
			<div className="py-12 text-center text-sm text-faint">
				Loading post details…
			</div>
		);
	}

	if (error || !post) {
		return (
			<div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
				Failed to load post.
			</div>
		);
	}

	const isReadOnly =
		post.status === "publishing" || post.status === "published";

	const handleSave = async (statusOverride?: "draft" | "queued") => {
		const scheduledAtVal = customDate
			? new Date(customDate).toISOString()
			: null;
		try {
			await patchMutation.mutateAsync({
				caption,
				memeIds: items.map((i) => i.meme.id),
				altTexts: items.map((i) => i.altText ?? null),
				scheduledAt: scheduledAtVal,
				...(statusOverride ? { status: statusOverride } : {}),
			});
			setSaveSuccess(true);
			setTimeout(() => setSaveSuccess(false), 3000);
		} catch (err) {
			console.error("Save post failed", err);
		}
	};

	const handlePublishNow = async () => {
		try {
			await publishNowMutation.mutateAsync();
		} catch (err) {
			console.error("Publish now failed", err);
		}
	};

	const handleCancel = async () => {
		try {
			await patchMutation.mutateAsync({ status: "cancelled" });
		} catch (err) {
			console.error("Cancel post failed", err);
		}
	};

	return (
		<div className="space-y-6">
			{/* Top nav */}
			<div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="sm" asChild>
						<Link href="/queue">
							<ArrowLeft className="size-4" />
							Queue
						</Link>
					</Button>
					<div className="h-4 w-px bg-line" />
					<div className="flex items-center gap-2">
						<span className="font-semibold text-fg">Post</span>
						<span className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs uppercase text-faint">
							{post.status}
						</span>
					</div>
				</div>

				<div className="flex items-center gap-2">
					{!isReadOnly && post.status !== "cancelled" && (
						<>
							{post.status === "draft" && (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => handleSave("queued")}
									disabled={patchMutation.isPending}
								>
									Queue Post
								</Button>
							)}

							<Button
								variant="primary"
								size="sm"
								onClick={() => handleSave()}
								disabled={patchMutation.isPending}
							>
								{patchMutation.isPending ? (
									"Saving…"
								) : saveSuccess ? (
									<>
										<Check className="size-4" /> Saved
									</>
								) : (
									<>
										<Save className="size-4" /> Save Changes
									</>
								)}
							</Button>

							<Button
								variant="secondary"
								size="sm"
								onClick={handlePublishNow}
								disabled={publishNowMutation.isPending}
							>
								<Send className="size-4" /> Publish Now
							</Button>

							<Button
								variant="ghost"
								size="sm"
								onClick={handleCancel}
								className="text-danger hover:bg-danger-soft"
							>
								<XCircle className="size-4" /> Cancel
							</Button>
						</>
					)}
				</div>
			</div>

			{/* Published permalink banner */}
			{post.permalink && (
				<div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm text-emerald-400">
					<span>This post is published on Instagram!</span>
					<a
						href={post.permalink}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 font-semibold hover:underline"
					>
						View on Instagram <ExternalLink className="size-3.5" />
					</a>
				</div>
			)}

			{/* Error banner if failed */}
			{post.error && (
				<div className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-sm text-danger">
					Publishing failed: {post.error}
				</div>
			)}

			{/* Two Column Layout */}
			<div className="grid gap-8 lg:grid-cols-12">
				{/* Left column: Editor */}
				<div className="space-y-6 lg:col-span-7">
					{/* Carousel Ordering */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
						<CarouselOrder
							items={items}
							onChange={setItems}
							disabled={isReadOnly}
						/>
					</div>

					{/* Caption Editor with live counter */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
						<CaptionEditor
							caption={caption}
							onChange={setCaption}
							items={items}
							readOnly={isReadOnly}
						/>
					</div>

					{/* Scheduling options */}
					<div className="rounded-xl border border-line bg-surface p-4 shadow-xs space-y-4">
						<div className="flex items-center gap-2 text-sm font-semibold text-fg">
							<Calendar className="size-4 text-accent" />
							Scheduling
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<Field label="Custom Date & Time" htmlFor="post-custom-date">
								<Input
									id="post-custom-date"
									type="datetime-local"
									value={customDate}
									onChange={(e) => setCustomDate(e.target.value)}
									disabled={isReadOnly}
									className="text-xs font-mono"
								/>
							</Field>

							{slots && slots.length > 0 && (
								<Field label="Recurring Weekly Slot" htmlFor="post-slot-picker">
									<Select
										id="post-slot-picker"
										disabled={isReadOnly}
										onChange={(e) => {
											// Helper to set datetime relative to selected weekday/time
											const val = e.target.value;
											if (!val) {
												setCustomDate("");
											}
										}}
									>
										<option value="">Next available free slot</option>
										{slots
											.filter((s) => s.enabled)
											.map((s) => (
												<option key={s.id} value={s.id}>
													{
														["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
															s.weekday
														]
													}{" "}
													at {s.time}
												</option>
											))}
									</Select>
								</Field>
							)}
						</div>

						{customDate && !isReadOnly && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setCustomDate("")}
								className="text-xs text-faint"
							>
								Clear custom time (revert to queue)
							</Button>
						)}
					</div>
				</div>

				{/* Right column: Instagram Style Preview */}
				<div className="space-y-6 lg:col-span-5">
					<div className="sticky top-6 space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold uppercase tracking-wider text-faint">
								Live Instagram Preview
							</span>
						</div>

						<InstagramPreview
							items={items}
							renderedCaption={post.renderedCaption}
						/>

						{/* Post info footer */}
						<div className="rounded-lg border border-line bg-surface p-3 text-xs text-faint space-y-1.5">
							<div className="flex justify-between">
								<span>Post ID:</span>
								<span className="font-mono">{post.id.slice(0, 8)}</span>
							</div>
							{post.scheduledAt && (
								<div className="flex justify-between">
									<span>Scheduled:</span>
									<span>{format(new Date(post.scheduledAt), "PPp")}</span>
								</div>
							)}
							{post.createdBy && (
								<div className="flex justify-between">
									<span>Created by:</span>
									<span>{post.createdBy.username ?? "user"}</span>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
