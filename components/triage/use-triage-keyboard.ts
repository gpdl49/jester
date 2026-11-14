"use client";

import { useEffect } from "react";

export type KeyboardHandlers = {
	onNext: () => void;
	onPrev: () => void;
	onToggleSelect: () => void;
	onAccept: (isBulk: boolean) => void;
	onReject: (isBulk: boolean) => void;
	enabled?: boolean;
};

export function useTriageKeyboard({
	onNext,
	onPrev,
	onToggleSelect,
	onAccept,
	onReject,
	enabled = true,
}: KeyboardHandlers) {
	useEffect(() => {
		if (!enabled) return;

		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT" ||
					target.isContentEditable)
			) {
				return;
			}

			// Don't intercept modifier combinations like Cmd+R, Ctrl+A etc. (except Shift)
			if (e.metaKey || e.ctrlKey || e.altKey) {
				return;
			}

			if (e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") {
				e.preventDefault();
				onNext();
			} else if (
				e.key === "k" ||
				e.key === "ArrowUp" ||
				e.key === "ArrowLeft"
			) {
				e.preventDefault();
				onPrev();
			} else if (e.key === "x") {
				e.preventDefault();
				onToggleSelect();
			} else if (e.key === "a") {
				e.preventDefault();
				onAccept(false);
			} else if (e.key === "A") {
				e.preventDefault();
				onAccept(true);
			} else if (e.key === "r") {
				e.preventDefault();
				onReject(false);
			} else if (e.key === "R") {
				e.preventDefault();
				onReject(true);
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [enabled, onNext, onPrev, onToggleSelect, onAccept, onReject]);
}
