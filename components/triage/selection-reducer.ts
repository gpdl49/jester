export type SelectionState = {
	itemIds: string[];
	focusedIndex: number;
	selectedIds: Set<string>;
	anchorIndex: number | null;
};

export type SelectionAction =
	| { type: "SET_ITEMS"; itemIds: string[] }
	| { type: "FOCUS_INDEX"; index: number }
	| { type: "FOCUS_NEXT" }
	| { type: "FOCUS_PREV" }
	| { type: "TOGGLE_SELECT"; id: string }
	| { type: "SELECT_RANGE"; toIndex: number }
	| { type: "SELECT_ALL" }
	| { type: "CLEAR_SELECTION" }
	| { type: "REMOVE_ITEMS"; ids: string[] };

export function initialSelectionState(itemIds: string[] = []): SelectionState {
	return {
		itemIds,
		focusedIndex: itemIds.length > 0 ? 0 : -1,
		selectedIds: new Set(),
		anchorIndex: null,
	};
}

export function selectionReducer(
	state: SelectionState,
	action: SelectionAction,
): SelectionState {
	switch (action.type) {
		case "SET_ITEMS": {
			const { itemIds } = action;
			let focusedIndex = state.focusedIndex;
			if (itemIds.length === 0) {
				focusedIndex = -1;
			} else if (focusedIndex < 0 || focusedIndex >= itemIds.length) {
				focusedIndex = 0;
			}
			// Keep existing selections that still exist
			const validSelected = new Set(
				[...state.selectedIds].filter((id) => itemIds.includes(id)),
			);
			return {
				...state,
				itemIds,
				focusedIndex,
				selectedIds: validSelected,
			};
		}

		case "FOCUS_INDEX": {
			if (state.itemIds.length === 0) return state;
			const index = Math.max(
				0,
				Math.min(state.itemIds.length - 1, action.index),
			);
			return {
				...state,
				focusedIndex: index,
			};
		}

		case "FOCUS_NEXT": {
			if (state.itemIds.length === 0) return state;
			const next = Math.min(state.itemIds.length - 1, state.focusedIndex + 1);
			return {
				...state,
				focusedIndex: next,
			};
		}

		case "FOCUS_PREV": {
			if (state.itemIds.length === 0) return state;
			const prev = Math.max(0, state.focusedIndex - 1);
			return {
				...state,
				focusedIndex: prev,
			};
		}

		case "TOGGLE_SELECT": {
			const id = action.id;
			const index = state.itemIds.indexOf(id);
			const nextSelected = new Set(state.selectedIds);
			if (nextSelected.has(id)) {
				nextSelected.delete(id);
			} else {
				nextSelected.add(id);
			}
			return {
				...state,
				selectedIds: nextSelected,
				anchorIndex: index >= 0 ? index : state.anchorIndex,
				focusedIndex: index >= 0 ? index : state.focusedIndex,
			};
		}

		case "SELECT_RANGE": {
			if (state.itemIds.length === 0) return state;
			const to = Math.max(
				0,
				Math.min(state.itemIds.length - 1, action.toIndex),
			);
			const from =
				state.anchorIndex !== null && state.anchorIndex >= 0
					? state.anchorIndex
					: Math.max(state.focusedIndex, 0);

			const start = Math.min(from, to);
			const end = Math.max(from, to);

			const nextSelected = new Set(state.selectedIds);
			for (let i = start; i <= end; i++) {
				const id = state.itemIds[i];
				if (id) {
					nextSelected.add(id);
				}
			}

			return {
				...state,
				selectedIds: nextSelected,
				anchorIndex: to,
				focusedIndex: to,
			};
		}

		case "SELECT_ALL": {
			return {
				...state,
				selectedIds: new Set(state.itemIds),
			};
		}

		case "CLEAR_SELECTION": {
			return {
				...state,
				selectedIds: new Set(),
				anchorIndex: null,
			};
		}

		case "REMOVE_ITEMS": {
			const toRemove = new Set(action.ids);
			const remaining = state.itemIds.filter((id) => !toRemove.has(id));
			const nextSelected = new Set(
				[...state.selectedIds].filter((id) => !toRemove.has(id)),
			);

			let nextFocus = state.focusedIndex;
			if (remaining.length === 0) {
				nextFocus = -1;
			} else if (nextFocus >= remaining.length) {
				nextFocus = remaining.length - 1;
			}

			return {
				...state,
				itemIds: remaining,
				selectedIds: nextSelected,
				focusedIndex: nextFocus,
				anchorIndex: null,
			};
		}

		default:
			return state;
	}
}
