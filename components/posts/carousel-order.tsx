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
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Input } from "@/components/ui/field";
import type { PostItemDto } from "@/lib/api/types";

export type CarouselOrderProps = {
	items: PostItemDto[];
	onChange: (items: PostItemDto[]) => void;
	disabled?: boolean;
};

function SortableItem({
	item,
	index,
	onAltTextChange,
	disabled,
}: {
	item: PostItemDto;
	index: number;
	onAltTextChange: (val: string) => void;
	disabled?: boolean;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.meme.id, disabled });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 20 : 1,
		opacity: isDragging ? 0.7 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5 shadow-xs"
		>
			<div className="relative aspect-square w-28 overflow-hidden rounded-md bg-canvas">
				{/* biome-ignore lint/performance/noImgElement: dynamic thumbnail */}
				<img
					src={item.meme.thumbUrl}
					alt={item.altText ?? item.meme.description ?? `Meme ${index + 1}`}
					className="size-full object-cover"
				/>
				<div className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
					#{index + 1}
				</div>
				{!disabled && (
					<button
						type="button"
						{...attributes}
						{...listeners}
						className="absolute top-1 right-1 cursor-grab rounded bg-black/70 p-1 text-white hover:bg-black/90 active:cursor-grabbing"
						aria-label="Drag to reorder"
					>
						<GripVertical className="size-3.5" />
					</button>
				)}
			</div>

			<Input
				type="text"
				placeholder="Alt text..."
				value={item.altText ?? ""}
				onChange={(e) => onAltTextChange(e.target.value)}
				disabled={disabled}
				className="h-7 text-xs"
			/>
		</div>
	);
}

export function CarouselOrder({
	items,
	onChange,
	disabled,
}: CarouselOrderProps) {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 5,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = items.findIndex((i) => i.meme.id === active.id);
		const newIndex = items.findIndex((i) => i.meme.id === over.id);

		if (oldIndex !== -1 && newIndex !== -1) {
			const reordered = arrayMove(items, oldIndex, newIndex).map(
				(item, idx) => ({
					...item,
					position: idx,
				}),
			);
			onChange(reordered);
		}
	};

	const handleAltChange = (index: number, alt: string) => {
		const next = [...items];
		const target = next[index];
		if (target) {
			next[index] = { ...target, altText: alt };
			onChange(next);
		}
	};

	return (
		<div className="space-y-2">
			<div className="text-xs font-semibold text-fg">
				Carousel Order ({items.length} {items.length === 1 ? "item" : "items"})
			</div>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={items.map((i) => i.meme.id)}
					strategy={horizontalListSortingStrategy}
				>
					<div className="flex flex-wrap gap-3 overflow-x-auto pb-2">
						{items.map((item, idx) => (
							<SortableItem
								key={item.meme.id}
								item={item}
								index={idx}
								onAltTextChange={(val) => handleAltChange(idx, val)}
								disabled={disabled}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	);
}
