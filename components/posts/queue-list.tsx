"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import type { PostSummaryDto } from "@/lib/api/types";
import { useReorderPosts } from "@/lib/client/posts";
import { QueueCard } from "./queue-card";

function SortableQueueItem({
	post,
	onPublishNow,
	onCancel,
}: {
	post: PostSummaryDto;
	onPublishNow: (id: string) => void;
	onCancel: (id: string) => void;
}) {
	const isUnscheduled = post.status === "queued" && post.scheduledAt === null;
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: post.id, disabled: !isUnscheduled });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 20 : 1,
		opacity: isDragging ? 0.6 : 1,
	};

	return (
		<div ref={setNodeRef} style={style}>
			<QueueCard
				post={post}
				onPublishNow={onPublishNow}
				onCancel={onCancel}
				isDraggable={isUnscheduled}
				dragHandleProps={{ ...attributes, ...listeners }}
			/>
		</div>
	);
}

export type QueueListProps = {
	queuedPosts: PostSummaryDto[];
	draftPosts: PostSummaryDto[];
	scheduleTimezone?: string;
};

export function QueueList({
	queuedPosts: initialQueued,
	draftPosts,
}: QueueListProps) {
	const [queued, setQueued] = useState<PostSummaryDto[]>(initialQueued);
	const reorderMutation = useReorderPosts();

	useEffect(() => {
		setQueued(initialQueued);
	}, [initialQueued]);

	const handlePublishNow = async (id: string) => {
		try {
			await fetch(`/api/posts/${id}/publish-now`, { method: "POST" });
			setQueued((prev) =>
				prev.map((p) => (p.id === id ? { ...p, status: "publishing" } : p)),
			);
		} catch (e) {
			console.error("Publish now failed", e);
		}
	};

	const handleCancel = async (id: string) => {
		try {
			await fetch(`/api/posts/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "cancelled" }),
			});
			setQueued((prev) => prev.filter((p) => p.id !== id));
		} catch (e) {
			console.error("Cancel post failed", e);
		}
	};

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = queued.findIndex((p) => p.id === active.id);
		const newIndex = queued.findIndex((p) => p.id === over.id);

		if (oldIndex !== -1 && newIndex !== -1) {
			const nextList = arrayMove(queued, oldIndex, newIndex);
			setQueued(nextList);

			// Persist only unscheduled queued posts
			const unscheduledIds = nextList
				.filter((p) => p.status === "queued" && p.scheduledAt === null)
				.map((p) => p.id);

			if (unscheduledIds.length > 0) {
				try {
					await reorderMutation.mutateAsync(unscheduledIds);
				} catch (err) {
					console.error("Failed to persist queue order", err);
				}
			}
		}
	};

	return (
		<div className="space-y-8">
			{/* Queued Section */}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-base font-semibold text-fg">
						Queued Posts ({queued.length})
					</h2>
					<span className="text-xs text-faint">
						Drag unscheduled posts to reorder priority
					</span>
				</div>

				{queued.length === 0 ? (
					<div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-faint">
						No posts in the queue. Approve memes or create posts to queue them.
					</div>
				) : (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={queued.map((p) => p.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className="space-y-3" data-testid="queued-posts-container">
								{queued.map((post) => (
									<SortableQueueItem
										key={post.id}
										post={post}
										onPublishNow={handlePublishNow}
										onCancel={handleCancel}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				)}
			</section>

			{/* Drafts Section */}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-base font-semibold text-fg">
						Drafts ({draftPosts.length})
					</h2>
				</div>

				{draftPosts.length === 0 ? (
					<div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">
						No drafts saved.
					</div>
				) : (
					<div className="space-y-3" data-testid="draft-posts-container">
						{draftPosts.map((post) => (
							<QueueCard
								key={post.id}
								post={post}
								onPublishNow={handlePublishNow}
								onCancel={handleCancel}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
