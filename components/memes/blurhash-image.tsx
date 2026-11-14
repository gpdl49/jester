"use client";

import { decode } from "blurhash";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";

export function BlurhashImage({
	src,
	alt,
	blurhash,
	width,
	height,
	className,
	imgClassName,
}: {
	src: string;
	alt: string;
	blurhash: string | null;
	width?: number | null;
	height?: number | null;
	className?: string;
	imgClassName?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		if (!blurhash || !canvasRef.current) return;
		try {
			const pixels = decode(blurhash, 32, 32);
			const canvas = canvasRef.current;
			canvas.width = 32;
			canvas.height = 32;
			const ctx = canvas.getContext("2d");
			if (ctx) {
				const imageData = ctx.createImageData(32, 32);
				imageData.data.set(pixels);
				ctx.putImageData(imageData, 0, 0);
			}
		} catch {
			// Ignore invalid blurhash
		}
	}, [blurhash]);

	const aspectRatio =
		width && height && height > 0 ? `${width} / ${height}` : "1 / 1";

	return (
		<div
			className={cn("relative overflow-hidden bg-sunken", className)}
			style={{ aspectRatio }}
		>
			{blurhash && (
				<canvas
					ref={canvasRef}
					className={cn(
						"absolute inset-0 size-full object-cover transition-opacity duration-300",
						loaded ? "opacity-0" : "opacity-100",
					)}
				/>
			)}
			<Image
				src={src}
				alt={alt}
				fill
				unoptimized
				onLoad={() => setLoaded(true)}
				className={cn(
					"size-full object-cover transition-opacity duration-300",
					loaded ? "opacity-100" : "opacity-0",
					imgClassName,
				)}
			/>
		</div>
	);
}
