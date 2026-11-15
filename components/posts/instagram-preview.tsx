"use client";

import {
	Bookmark,
	Camera,
	ChevronLeft,
	ChevronRight,
	Heart,
	MessageCircle,
	MoreHorizontal,
	Send,
} from "lucide-react";
import { useState } from "react";

export type InstagramPreviewProps = {
	username?: string;
	items: {
		position: number;
		meme: {
			id: string;
			thumbUrl: string;
			description?: string | null;
		};
		altText?: string | null;
	}[];
	renderedCaption: string;
};

export function InstagramPreview({
	username = "jester",
	items,
	renderedCaption,
}: InstagramPreviewProps) {
	const [currentIndex, setCurrentIndex] = useState(0);

	const isCarousel = items.length > 1;
	const currentItem = items[currentIndex] ?? items[0];

	const handlePrev = () => {
		setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
	};

	const handleNext = () => {
		setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
	};

	return (
		<div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface shadow-md">
			{/* Instagram Header */}
			<div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
				<div className="flex items-center gap-2.5">
					<div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-0.5 text-white">
						<div className="flex size-full items-center justify-center rounded-full bg-surface">
							<Camera className="size-4 text-fg" />
						</div>
					</div>
					<span className="text-xs font-semibold text-fg">@{username}</span>
				</div>
				<MoreHorizontal className="size-4 text-faint" />
			</div>

			{/* Image Frame (1:1 aspect ratio) */}
			<div className="relative aspect-square w-full overflow-hidden bg-black/90">
				{currentItem ? (
					// biome-ignore lint/performance/noImgElement: dynamic preview image
					<img
						src={currentItem.meme.thumbUrl}
						alt={currentItem.altText ?? currentItem.meme.description ?? "Meme"}
						className="size-full object-contain"
					/>
				) : (
					<div className="flex size-full items-center justify-center text-xs text-faint">
						No image
					</div>
				)}

				{/* Carousel Controls */}
				{isCarousel && (
					<>
						<button
							type="button"
							onClick={handlePrev}
							className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
							aria-label="Previous image"
						>
							<ChevronLeft className="size-4" />
						</button>
						<button
							type="button"
							onClick={handleNext}
							className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
							aria-label="Next image"
						>
							<ChevronRight className="size-4" />
						</button>
						<div className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
							{currentIndex + 1}/{items.length}
						</div>
					</>
				)}
			</div>

			{/* Action Bar & Dots */}
			<div className="p-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<Heart className="size-5 text-fg hover:text-rose-500" />
						<MessageCircle className="size-5 text-fg" />
						<Send className="size-5 text-fg" />
					</div>

					{/* Carousel Dots */}
					{isCarousel && (
						<div className="flex items-center gap-1">
							{items.map((item, idx) => (
								<button
									key={item.meme.id}
									type="button"
									onClick={() => setCurrentIndex(idx)}
									className={`size-1.5 rounded-full transition ${
										idx === currentIndex
											? "bg-accent"
											: "bg-line hover:bg-fg/50"
									}`}
									aria-label={`Go to slide ${idx + 1}`}
								/>
							))}
						</div>
					)}

					<Bookmark className="size-5 text-fg" />
				</div>

				{/* Caption */}
				<div className="mt-2.5 text-xs text-fg leading-snug">
					<span className="font-semibold mr-1.5">@{username}</span>
					<span className="whitespace-pre-wrap">
						{renderedCaption || <span className="text-faint">No caption</span>}
					</span>
				</div>
			</div>
		</div>
	);
}
