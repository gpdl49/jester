// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { ScheduleSlotsEditor } from "./schedule-slots-editor";

describe("ScheduleSlotsEditor component", () => {
	it("renders weekday schedule slots", async () => {
		mockApi({
			"GET /api/schedule/slots": [
				{
					id: "slot-1",
					accountId: null,
					weekday: 1, // Monday
					time: "10:00",
					enabled: true,
				},
				{
					id: "slot-2",
					accountId: null,
					weekday: 1,
					time: "18:00",
					enabled: false,
				},
			],
		});

		renderWithQuery(<ScheduleSlotsEditor />);

		expect(await screen.findByText("10:00")).toBeInTheDocument();
		expect(screen.getByText("18:00")).toBeInTheDocument();
		expect(screen.getByText("Monday")).toBeInTheDocument();
		expect(screen.getByText("Sunday")).toBeInTheDocument();
	});

	it("toggles slot enabled state", async () => {
		mockApi({
			"GET /api/schedule/slots": [
				{
					id: "slot-1",
					accountId: null,
					weekday: 1,
					time: "10:00",
					enabled: true,
				},
			],
		});

		renderWithQuery(<ScheduleSlotsEditor />);

		const disableBtn = await screen.findByRole("button", { name: "Disable" });
		expect(disableBtn).toBeInTheDocument();

		fireEvent.click(disableBtn);
		expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
	});
});
