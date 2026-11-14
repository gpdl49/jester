"use client";

import { Inbox } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	EmptyState,
	ErrorText,
	Loading,
	Spinner,
} from "@/components/ui/feedback";
import type { TriageCandidateDto, TriageStatus } from "@/lib/api/types";
import {
	postTriageDecisions,
	useTriageAcceptAbove,
	useTriageCandidates,
	useTriageDecisions,
	useTriageReset,
} from "@/lib/client/triage";
import { initialSelectionState, selectionReducer } from "./selection-reducer";
import { TriageCard } from "./triage-card";
import { TriageToolbar } from "./triage-toolbar";
import { TriageUndoBanner } from "./triage-undo-banner";
import { useTriageKeyboard } from "./use-triage-keyboard";

export function TriageView({ isAdmin = false }: { isAdmin?: boolean }) {
	const [status, setStatus] = useState<TriageStatus>("scored");

	const {
		data,
		isLoading,
		isError,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useTriageCandidates({ status });

	const decisionsMutation = useTriageDecisions();
	const acceptAboveMutation = useTriageAcceptAbove();
	const resetMutation = useTriageReset();

	// Flatten all loaded items from paginated query
	const allServerCandidates = useMemo(
		() => data?.pages.flatMap((page) => page.items) ?? [],
		[data],
	);

	// Pending decisions held in memory during the 5-second undo window
	const [pendingDecisions, setPendingDecisions] = useState<
		{
			id: string;
			decision: "accept" | "reject";
			candidate: TriageCandidateDto;
		}[]
	>([]);

	// Ids whose decision has been sent but whose refetch hasn't landed yet;
	// keeps them hidden so they can't flash back and be decided twice.
	const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set());

	const pendingIdsSet = useMemo(() => {
		const ids = new Set(pendingDecisions.map((p) => p.id));
		for (const id of inFlightIds) ids.add(id);
		return ids;
	}, [pendingDecisions, inFlightIds]);

	// Filter out optimistically decided items
	const visibleCandidates = useMemo(
		() => allServerCandidates.filter((c) => !pendingIdsSet.has(c.id)),
		[allServerCandidates, pendingIdsSet],
	);

	const visibleIds = useMemo(
		() => visibleCandidates.map((c) => c.id),
		[visibleCandidates],
	);

	// Selection and navigation state
	const [selection, dispatch] = useReducer(
		selectionReducer,
		visibleIds,
		initialSelectionState,
	);

	// Keep reducer's items in sync when visible candidates change
	useEffect(() => {
		dispatch({ type: "SET_ITEMS", itemIds: visibleIds });
	}, [visibleIds]);

	// Undo timer state
	const [secondsRemaining, setSecondsRemaining] = useState(5);
	const timerRef = useRef<NodeJS.Timeout | null>(null);
	const countdownRef = useRef<NodeJS.Timeout | null>(null);

	// Mirrors pendingDecisions so flush can read it without a state updater
	// (updaters must be pure; StrictMode runs them twice).
	const pendingRef = useRef(pendingDecisions);
	pendingRef.current = pendingDecisions;

	const flushPendingDecisions = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		if (countdownRef.current) clearInterval(countdownRef.current);
		timerRef.current = null;
		countdownRef.current = null;

		const current = pendingRef.current;
		if (current.length === 0) return;
		pendingRef.current = [];
		setPendingDecisions([]);

		const ids = current.map((p) => p.id);
		setInFlightIds((prev) => new Set([...prev, ...ids]));
		decisionsMutation.mutate(
			current.map((p) => ({ immichAssetId: p.id, decision: p.decision })),
			{
				onSettled: () =>
					setInFlightIds((prev) => {
						const next = new Set(prev);
						for (const id of ids) next.delete(id);
						return next;
					}),
			},
		);
	}, [decisionsMutation]);

	// Navigating away applies what the user already decided instead of
	// silently dropping it.
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
			if (countdownRef.current) clearInterval(countdownRef.current);
			const current = pendingRef.current;
			if (current.length > 0) {
				void postTriageDecisions(
					current.map((p) => ({ immichAssetId: p.id, decision: p.decision })),
				).catch(() => {});
			}
		};
	}, []);

	const handleStatusChange = useCallback(
		(newStatus: TriageStatus) => {
			if (pendingDecisions.length > 0) {
				flushPendingDecisions();
			}
			setStatus(newStatus);
		},
		[pendingDecisions.length, flushPendingDecisions],
	);

	// Queue decisions with optimistic removal & 5s window
	const queueDecisions = useCallback(
		(ids: string[], decision: "accept" | "reject") => {
			const idSet = new Set(ids);
			const toAdd = visibleCandidates
				.filter((c) => idSet.has(c.id))
				.map((c) => ({ id: c.id, decision, candidate: c }));

			if (toAdd.length === 0) return;

			setPendingDecisions((prev) => [...prev, ...toAdd]);
			dispatch({ type: "REMOVE_ITEMS", ids });

			// Reset 5s countdown
			if (timerRef.current) clearTimeout(timerRef.current);
			if (countdownRef.current) clearInterval(countdownRef.current);

			setSecondsRemaining(5);
			countdownRef.current = setInterval(() => {
				setSecondsRemaining((sec) => Math.max(0, sec - 1));
			}, 1000);

			timerRef.current = setTimeout(() => {
				flushPendingDecisions();
			}, 5000);
		},
		[visibleCandidates, flushPendingDecisions],
	);

	const handleUndo = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		if (countdownRef.current) clearInterval(countdownRef.current);
		timerRef.current = null;
		countdownRef.current = null;
		setPendingDecisions([]);
		setSecondsRemaining(5);
	}, []);

	// Focused item id
	const focusedId =
		selection.focusedIndex >= 0
			? selection.itemIds[selection.focusedIndex]
			: undefined;

	// Single item actions
	const handleAcceptSingle = useCallback(
		(id: string) => {
			queueDecisions([id], "accept");
		},
		[queueDecisions],
	);

	const handleRejectSingle = useCallback(
		(id: string) => {
			queueDecisions([id], "reject");
		},
		[queueDecisions],
	);

	// Bulk / selection actions
	const handleAcceptBulk = useCallback(
		(isBulk: boolean) => {
			if (selection.selectedIds.size > 0 || isBulk) {
				const ids =
					selection.selectedIds.size > 0
						? Array.from(selection.selectedIds)
						: focusedId
							? [focusedId]
							: [];
				if (ids.length > 0) {
					queueDecisions(ids, "accept");
				}
			} else if (focusedId) {
				queueDecisions([focusedId], "accept");
			}
		},
		[selection.selectedIds, focusedId, queueDecisions],
	);

	const handleRejectBulk = useCallback(
		(isBulk: boolean) => {
			if (selection.selectedIds.size > 0 || isBulk) {
				const ids =
					selection.selectedIds.size > 0
						? Array.from(selection.selectedIds)
						: focusedId
							? [focusedId]
							: [];
				if (ids.length > 0) {
					queueDecisions(ids, "reject");
				}
			} else if (focusedId) {
				queueDecisions([focusedId], "reject");
			}
		},
		[selection.selectedIds, focusedId, queueDecisions],
	);

	// Keyboard bindings hook
	const canDecide =
		status === "scored" || status === "pending" || status === "error";
	useTriageKeyboard({
		onNext: () => dispatch({ type: "FOCUS_NEXT" }),
		onPrev: () => dispatch({ type: "FOCUS_PREV" }),
		onToggleSelect: () => {
			if (focusedId) dispatch({ type: "TOGGLE_SELECT", id: focusedId });
		},
		onAccept: (isBulk) => {
			if (canDecide) handleAcceptBulk(isBulk);
		},
		onReject: (isBulk) => {
			if (canDecide) handleRejectBulk(isBulk);
		},
		enabled: visibleCandidates.length > 0,
	});

	// Infinite scroll intersection observer
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const target = loadMoreRef.current;
		if (!target || !hasNextPage || isFetchingNextPage) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					fetchNextPage();
				}
			},
			{ threshold: 0.1 },
		);

		observer.observe(target);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	return (
		<div className="flex flex-col gap-4">
			{/* Toolbar with tabs, selection count, accept-above slider */}
			<TriageToolbar
				currentStatus={status}
				onStatusChange={handleStatusChange}
				selectedCount={selection.selectedIds.size}
				onAcceptSelected={() => handleAcceptBulk(true)}
				onRejectSelected={() => handleRejectBulk(true)}
				onClearSelection={() => dispatch({ type: "CLEAR_SELECTION" })}
				isAdmin={isAdmin}
				onAcceptAbove={async (threshold) => {
					await acceptAboveMutation.mutateAsync(threshold);
				}}
			/>

			{/* Error banner */}
			{isError && <ErrorText error={error} />}

			{/* Loading initial */}
			{isLoading && <Loading label="Loading triage candidates…" />}

			{/* Empty state */}
			{!isLoading && visibleCandidates.length === 0 && (
				<EmptyState
					icon={<Inbox className="size-8" />}
					title={`No ${status} candidates`}
				>
					{status === "scored"
						? "All caught up! New candidates from Immich scans will appear here."
						: `There are currently no assets with status "${status}".`}
				</EmptyState>
			)}

			{/* Grid of candidates */}
			{visibleCandidates.length > 0 && (
				<ul
					aria-label="Triage candidates"
					className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 p-0 m-0"
				>
					{visibleCandidates.map((candidate, idx) => (
						<TriageCard
							key={candidate.id}
							candidate={candidate}
							index={idx}
							isFocused={idx === selection.focusedIndex}
							isSelected={selection.selectedIds.has(candidate.id)}
							isAdmin={isAdmin}
							canDecide={canDecide}
							onFocus={(index) => dispatch({ type: "FOCUS_INDEX", index })}
							onToggleSelect={(id) => dispatch({ type: "TOGGLE_SELECT", id })}
							onShiftClick={(toIndex) =>
								dispatch({ type: "SELECT_RANGE", toIndex })
							}
							onAccept={handleAcceptSingle}
							onReject={handleRejectSingle}
							onReset={async (id) => {
								await resetMutation.mutateAsync(id);
							}}
						/>
					))}
				</ul>
			)}

			{/* Infinite scroll loader trigger */}
			<div ref={loadMoreRef} className="py-6 flex justify-center">
				{isFetchingNextPage && (
					<div className="flex items-center gap-2 text-xs text-muted">
						<Spinner />
						Loading more candidates…
					</div>
				)}
			</div>

			{/* 5-second Undo Banner */}
			<TriageUndoBanner
				count={pendingDecisions.length}
				secondsRemaining={secondsRemaining}
				onUndo={handleUndo}
				onFlushNow={flushPendingDecisions}
			/>
		</div>
	);
}
