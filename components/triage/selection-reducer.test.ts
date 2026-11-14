import { describe, expect, it } from "vitest";
import { initialSelectionState, selectionReducer } from "./selection-reducer";

describe("selectionReducer", () => {
	const items = ["item-1", "item-2", "item-3", "item-4", "item-5"];

	it("initializes with first item focused", () => {
		const state = initialSelectionState(items);
		expect(state.itemIds).toEqual(items);
		expect(state.focusedIndex).toBe(0);
		expect(state.selectedIds.size).toBe(0);
	});

	it("handles empty items initialization", () => {
		const state = initialSelectionState([]);
		expect(state.focusedIndex).toBe(-1);
	});

	it("moves focus with FOCUS_NEXT and FOCUS_PREV within bounds", () => {
		let state = initialSelectionState(items);
		expect(state.focusedIndex).toBe(0);

		// cannot go prev from 0
		state = selectionReducer(state, { type: "FOCUS_PREV" });
		expect(state.focusedIndex).toBe(0);

		state = selectionReducer(state, { type: "FOCUS_NEXT" });
		expect(state.focusedIndex).toBe(1);

		state = selectionReducer(state, { type: "FOCUS_NEXT" });
		state = selectionReducer(state, { type: "FOCUS_NEXT" });
		state = selectionReducer(state, { type: "FOCUS_NEXT" });
		expect(state.focusedIndex).toBe(4);

		// cannot exceed bounds
		state = selectionReducer(state, { type: "FOCUS_NEXT" });
		expect(state.focusedIndex).toBe(4);

		state = selectionReducer(state, { type: "FOCUS_PREV" });
		expect(state.focusedIndex).toBe(3);
	});

	it("toggles item selection and updates anchor", () => {
		let state = initialSelectionState(items);
		state = selectionReducer(state, {
			type: "TOGGLE_SELECT",
			id: "item-2",
		});
		expect(state.selectedIds.has("item-2")).toBe(true);
		expect(state.focusedIndex).toBe(1);
		expect(state.anchorIndex).toBe(1);

		// toggle off
		state = selectionReducer(state, {
			type: "TOGGLE_SELECT",
			id: "item-2",
		});
		expect(state.selectedIds.has("item-2")).toBe(false);
	});

	it("selects a range with shift-select (SELECT_RANGE)", () => {
		let state = initialSelectionState(items);
		// select item-2 first as anchor
		state = selectionReducer(state, {
			type: "TOGGLE_SELECT",
			id: "item-2",
		});
		expect(state.anchorIndex).toBe(1);

		// shift select to item-4 (index 3)
		state = selectionReducer(state, {
			type: "SELECT_RANGE",
			toIndex: 3,
		});
		expect(state.selectedIds.has("item-2")).toBe(true);
		expect(state.selectedIds.has("item-3")).toBe(true);
		expect(state.selectedIds.has("item-4")).toBe(true);
		expect(state.selectedIds.has("item-1")).toBe(false);
		expect(state.selectedIds.has("item-5")).toBe(false);
	});

	it("selects all and clears selection", () => {
		let state = initialSelectionState(items);
		state = selectionReducer(state, { type: "SELECT_ALL" });
		expect(state.selectedIds.size).toBe(5);

		state = selectionReducer(state, { type: "CLEAR_SELECTION" });
		expect(state.selectedIds.size).toBe(0);
	});

	it("removes items and adjusts focus index", () => {
		let state = initialSelectionState(items);
		state = selectionReducer(state, { type: "FOCUS_INDEX", index: 4 });
		expect(state.focusedIndex).toBe(4);

		// remove last two items
		state = selectionReducer(state, {
			type: "REMOVE_ITEMS",
			ids: ["item-4", "item-5"],
		});
		expect(state.itemIds).toEqual(["item-1", "item-2", "item-3"]);
		// focus should be adjusted to new last index (2)
		expect(state.focusedIndex).toBe(2);

		// remove all items
		state = selectionReducer(state, {
			type: "REMOVE_ITEMS",
			ids: ["item-1", "item-2", "item-3"],
		});
		expect(state.itemIds).toEqual([]);
		expect(state.focusedIndex).toBe(-1);
	});
});
