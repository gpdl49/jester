// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./settings-view";
import type { MeDto, SettingsDto } from "@/lib/api/types";
import { CurrentUserContext } from "@/lib/client/current-user";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
	useSearchParams: () => mockSearchParams,
}));

const adminUser: MeDto = {
	id: "u-admin",
	sub: "s-admin",
	email: "admin@example.com",
	username: "admin",
	groups: ["memes", "memes-admin"],
	isAdmin: true,
};

const regularUser: MeDto = {
	id: "u-user",
	sub: "s-user",
	email: "user@example.com",
	username: "user",
	groups: ["memes"],
	isAdmin: false,
};

const initialSettings: SettingsDto = {
	"prefilter.threshold": 0.35,
	"triage.autoAcceptThreshold": null,
	"immich.smartQueries": ["meme", "funny joke"],
	"caption.template": "{caption}\n\n{credit}\n\n{hashtags}",
	"caption.unknownCredit": "Creator unknown — DM for credit/removal",
	"ai.dailyBudgetUsd": 3,
	"ai.paused": false,
	"immich.deletePaused": false,
	"publishing.paused": false,
};

afterEach(cleanup);

describe("SettingsView component", () => {
	beforeEach(() => {
		mockSearchParams.delete("instagram");
	});

	it("shows 'Admins only' for non-admin users", () => {
		renderWithQuery(
			<CurrentUserContext.Provider value={regularUser}>
				<SettingsView />
			</CurrentUserContext.Provider>,
		);

		expect(screen.getByText("Admins only")).toBeInTheDocument();
		expect(screen.getByText("memes-admin")).toBeInTheDocument();
		expect(screen.queryByText("Prefilter Score Threshold")).not.toBeInTheDocument();
	});

	it("renders all sections for admin users", async () => {
		mockApi({
			"GET /api/settings": initialSettings,
		});

		renderWithQuery(
			<CurrentUserContext.Provider value={adminUser}>
				<SettingsView />
			</CurrentUserContext.Provider>,
		);

		// Verify loading then settings content
		await waitFor(() => {
			expect(
				screen.getByText("Triage & Prefilter Thresholds"),
			).toBeInTheDocument();
		});

		expect(screen.getByText("Prefilter Score Threshold")).toBeInTheDocument();
		expect(screen.getByText("Immich Smart-Search Queries")).toBeInTheDocument();
		expect(screen.getByText("Captions & Credits")).toBeInTheDocument();
		expect(screen.getByText("AI Configuration & Spend")).toBeInTheDocument();
		expect(screen.getByText("Emergency Kill Switches")).toBeInTheDocument();
	});

	it("toggles auto-accept and displays permanent deletion warning", async () => {
		mockApi({
			"GET /api/settings": initialSettings,
		});

		renderWithQuery(
			<CurrentUserContext.Provider value={adminUser}>
				<SettingsView />
			</CurrentUserContext.Provider>,
		);

		await waitFor(() => {
			expect(
				screen.getByText("Enable Auto-Accept for high-confidence memes"),
			).toBeInTheDocument();
		});

		// Initially auto-accept warning is not visible
		expect(
			screen.queryByText(/Permanent Deletion Warning/),
		).not.toBeInTheDocument();

		// Check the checkbox
		const checkbox = screen.getByRole("checkbox", {
			name: /Enable Auto-Accept for high-confidence memes/,
		});
		fireEvent.click(checkbox);

		// Now warning and threshold slider are shown
		expect(screen.getByText(/Permanent Deletion Warning/)).toBeInTheDocument();
		expect(
			screen.getByText("Auto-Accept Probability Threshold"),
		).toBeInTheDocument();
	});

	it("shows live sample caption update and validates placeholder", async () => {
		mockApi({
			"GET /api/settings": initialSettings,
		});

		renderWithQuery(
			<CurrentUserContext.Provider value={adminUser}>
				<SettingsView />
			</CurrentUserContext.Provider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Caption Template")).toBeInTheDocument();
		});

		// Check that the template has live preview
		expect(screen.getByText("Live Preview Sample")).toBeInTheDocument();
		expect(screen.getAllByText(/When all tests pass/)).toHaveLength(2);

		// Erase template
		const textarea = screen.getByRole("textbox", {
			name: /Caption Template/,
		});
		fireEvent.change(textarea, { target: { value: "invalid template" } });

		expect(
			screen.getByText("Template must contain the placeholder {caption}."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Save Caption Settings" }),
		).toBeDisabled();
	});

	it("shows success toast when ?instagram=connected is present in URL", async () => {
		mockSearchParams.set("instagram", "connected");
		mockApi({
			"GET /api/settings": initialSettings,
		});

		renderWithQuery(
			<CurrentUserContext.Provider value={adminUser}>
				<SettingsView />
			</CurrentUserContext.Provider>,
		);

		await waitFor(() => {
			expect(
				screen.getByText("Instagram account connected successfully!"),
			).toBeInTheDocument();
		});
	});
});
