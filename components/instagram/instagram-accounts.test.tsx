// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithQuery } from "@/test/helpers/dom";
import { InstagramAccounts } from "./instagram-accounts";

describe("InstagramAccounts component", () => {
	it("renders setup instructions when feature is disabled (503)", async () => {
		mockApi({
			"GET /api/instagram/accounts": new Response(
				JSON.stringify({
					error: "feature_disabled",
					message: "Instagram is not configured",
				}),
				{ status: 503, headers: { "Content-Type": "application/json" } },
			),
		});

		renderWithQuery(<InstagramAccounts />);

		await waitFor(() => {
			expect(
				screen.getByText(/Instagram publishing is currently disabled/i),
			).toBeInTheDocument();
		});
		expect(screen.getByText(/TOKEN_ENCRYPTION_KEY/i)).toBeInTheDocument();
	});

	it("renders connected accounts list with limit and default status", async () => {
		const futureDate = new Date(
			Date.now() + 20 * 24 * 60 * 60 * 1000,
		).toISOString();
		mockApi({
			"GET /api/instagram/accounts": [
				{
					id: "acc-1",
					igUserId: "ig-1",
					username: "meme_master",
					tokenExpiresAt: futureDate,
					isDefault: true,
					createdAt: new Date().toISOString(),
				},
				{
					id: "acc-2",
					igUserId: "ig-2",
					username: "second_account",
					tokenExpiresAt: futureDate,
					isDefault: false,
					createdAt: new Date().toISOString(),
				},
			],
			"GET /api/instagram/accounts/acc-1/limit": {
				used: 12,
				total: 100,
			},
			"GET /api/instagram/accounts/acc-2/limit": {
				used: 3,
				total: 100,
			},
		});

		renderWithQuery(<InstagramAccounts />);

		await waitFor(() => {
			expect(screen.getByText("@meme_master")).toBeInTheDocument();
			expect(screen.getByText("@second_account")).toBeInTheDocument();
		});

		expect(screen.getByText("Default")).toBeInTheDocument();
		expect(screen.getByText("Make default")).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByText("12 / 100 used today")).toBeInTheDocument();
		});
	});

	it("allows switching default account", async () => {
		const futureDate = new Date(
			Date.now() + 20 * 24 * 60 * 60 * 1000,
		).toISOString();
		let defaultAcc = "acc-1";
		mockApi({
			"GET /api/instagram/accounts": () => [
				{
					id: "acc-1",
					igUserId: "ig-1",
					username: "meme_master",
					tokenExpiresAt: futureDate,
					isDefault: defaultAcc === "acc-1",
					createdAt: new Date().toISOString(),
				},
				{
					id: "acc-2",
					igUserId: "ig-2",
					username: "second_account",
					tokenExpiresAt: futureDate,
					isDefault: defaultAcc === "acc-2",
					createdAt: new Date().toISOString(),
				},
			],
			"GET /api/instagram/accounts/acc-1/limit": { used: 0, total: 100 },
			"GET /api/instagram/accounts/acc-2/limit": { used: 0, total: 100 },
			"POST /api/instagram/accounts/acc-2/default": () => {
				defaultAcc = "acc-2";
				return {
					id: "acc-2",
					igUserId: "ig-2",
					username: "second_account",
					tokenExpiresAt: futureDate,
					isDefault: true,
					createdAt: new Date().toISOString(),
				};
			},
		});

		renderWithQuery(<InstagramAccounts />);

		await waitFor(() => {
			expect(screen.getByText("@second_account")).toBeInTheDocument();
		});

		const makeDefaultBtn = screen.getByText("Make default");
		await userEvent.click(makeDefaultBtn);

		await waitFor(() => {
			expect(defaultAcc).toBe("acc-2");
		});
	});
});
