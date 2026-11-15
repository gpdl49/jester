import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

/** A rectangle in the container's own coordinate space (scroll-independent). */
export type DragRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type Box = { left: number; top: number; right: number; bottom: number };

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Distance from the viewport edge where dragging auto-scrolls the page. */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 18;

export function boxesIntersect(a: Box, b: Box): boolean {
	return (
		a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
	);
}

type Options = {
	containerRef: RefObject<HTMLElement | null>;
	/** Ids currently selected; read when a drag starts so modifier-drags can extend it. */
	getSelectedIds: () => Iterable<string>;
	onSelectionChange: (ids: string[]) => void;
	enabled?: boolean;
};

/**
 * Rubber-band selection: press on the grid with a mouse and drag to select
 * every card (`[data-card-id]`) the rectangle touches. Holding shift, ctrl or
 * cmd adds to the existing selection instead of replacing it.
 */
export function useDragSelect({
	containerRef,
	getSelectedIds,
	onSelectionChange,
	enabled = true,
}: Options) {
	const [rect, setRect] = useState<DragRect | null>(null);

	const optionsRef = useRef({ getSelectedIds, onSelectionChange });
	optionsRef.current = { getSelectedIds, onSelectionChange };

	const cleanupRef = useRef<(() => void) | null>(null);
	const suppressClickRef = useRef(false);

	useEffect(() => () => cleanupRef.current?.(), []);

	const onPointerDown = useCallback(
		(e: ReactPointerEvent<HTMLElement>) => {
			const container = containerRef.current;
			if (!enabled || !container) return;
			// Touch keeps scrolling; only mouse (and pen) drags select.
			if (e.pointerType === "touch" || e.button !== 0) return;
			if ((e.target as HTMLElement).closest("button, a, input, select")) return;

			cleanupRef.current?.();

			const origin = container.getBoundingClientRect();
			const anchor = { x: e.clientX - origin.left, y: e.clientY - origin.top };
			const additive = e.shiftKey || e.ctrlKey || e.metaKey;
			const base = additive ? [...optionsRef.current.getSelectedIds()] : [];
			const start = { x: e.clientX, y: e.clientY };
			const pointer = { x: e.clientX, y: e.clientY };
			let dragging = false;
			let frame = 0;
			let prevUserSelect = "";

			function update() {
				if (!container) return;
				const box = container.getBoundingClientRect();
				const x = pointer.x - box.left;
				const y = pointer.y - box.top;
				const sel: Box = {
					left: Math.min(anchor.x, x),
					top: Math.min(anchor.y, y),
					right: Math.max(anchor.x, x),
					bottom: Math.max(anchor.y, y),
				};
				setRect({
					left: sel.left,
					top: sel.top,
					width: sel.right - sel.left,
					height: sel.bottom - sel.top,
				});

				const ids = new Set(base);
				for (const el of container.querySelectorAll<HTMLElement>(
					"[data-card-id]",
				)) {
					const r = el.getBoundingClientRect();
					const card: Box = {
						left: r.left - box.left,
						top: r.top - box.top,
						right: r.right - box.left,
						bottom: r.bottom - box.top,
					};
					const id = el.dataset.cardId;
					if (id && boxesIntersect(sel, card)) ids.add(id);
				}
				optionsRef.current.onSelectionChange([...ids]);
			}

			// Scroll the page while the pointer sits near the top/bottom edge.
			function tick() {
				const vh = window.innerHeight;
				const dy =
					pointer.y < SCROLL_EDGE
						? -SCROLL_STEP
						: pointer.y > vh - SCROLL_EDGE
							? SCROLL_STEP
							: 0;
				if (dy !== 0) {
					window.scrollBy(0, dy);
					update();
				}
				frame = requestAnimationFrame(tick);
			}

			function onMove(ev: PointerEvent) {
				pointer.x = ev.clientX;
				pointer.y = ev.clientY;
				if (!dragging) {
					if (
						Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <
						DRAG_THRESHOLD
					) {
						return;
					}
					dragging = true;
					prevUserSelect = document.body.style.userSelect;
					document.body.style.userSelect = "none";
					frame = requestAnimationFrame(tick);
				}
				update();
			}

			function finish() {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", finish);
				window.removeEventListener("pointercancel", finish);
				cancelAnimationFrame(frame);
				cleanupRef.current = null;
				if (dragging) {
					document.body.style.userSelect = prevUserSelect;
					setRect(null);
					// The click that follows a drag must not focus or toggle a card.
					suppressClickRef.current = true;
					setTimeout(() => {
						suppressClickRef.current = false;
					}, 0);
				}
			}

			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", finish);
			window.addEventListener("pointercancel", finish);
			cleanupRef.current = finish;
		},
		[containerRef, enabled],
	);

	const onClickCapture = useCallback((e: { stopPropagation: () => void }) => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			e.stopPropagation();
		}
	}, []);

	return { rect, onPointerDown, onClickCapture };
}
