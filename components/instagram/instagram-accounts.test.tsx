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
					needsReconnect: false,
					isDefault: true,
					createdAt: new Date().toISOString(),
				},
				{
					id: "acc-2",
					igUserId: "ig-2",
					username: "second_account",
					tokenExpiresAt: futureDate,
					needsReconnect: false,
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
					needsReconnect: false,
					isDefault: defaultAcc === "acc-1",
					createdAt: new Date().toISOString(),
				},
				{
					id: "acc-2",
					igUserId: "ig-2",
					username: "second_account",
					tokenExpiresAt: futureDate,
					needsReconnect: false,
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
					needsReconnect: false,
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

	it("shows non-expiring tokens and a reconnect message when Meta rejected the token", async () => {
		const now = new Date().toISOString();
		mockApi({
			"GET /api/instagram/accounts": [
				{
					id: "a1",
					igUserId: "1",
					username: "never_expires",
					tokenExpiresAt: null,
					needsReconnect: false,
					isDefault: true,
					createdAt: now,
				},
				{
					id: "a2",
					igUserId: "2",
					username: "revoked",
					tokenExpiresAt: null,
					needsReconnect: true,
					isDefault: false,
					createdAt: now,
				},
			],
			"GET /api/instagram/accounts/a1/limit": { used: 0, total: 100 },
			"GET /api/instagram/accounts/a2/limit": { used: 0, total: 100 },
		});
		renderWithQuery(<InstagramAccounts />);
		await waitFor(() => {
			expect(screen.getByText("Token does not expire")).toBeInTheDocument();
		});
		expect(screen.getByText(/Meta rejected this account/i)).toBeInTheDocument();
	});

	it("asks the admin to choose when several accounts have no default", async () => {
		const now = new Date().toISOString();
		const row = (id: string, name: string) => ({
			id,
			igUserId: id,
			username: name,
			tokenExpiresAt: null,
			needsReconnect: false,
			isDefault: false,
			createdAt: now,
		});
		mockApi({
			"GET /api/instagram/accounts": [row("a1", "one"), row("a2", "two")],
			"GET /api/instagram/accounts/a1/limit": { used: 0, total: 100 },
			"GET /api/instagram/accounts/a2/limit": { used: 0, total: 100 },
		});
		renderWithQuery(<InstagramAccounts />);
		await waitFor(() => {
			expect(
				screen.getByText(/Several Instagram accounts/i),
			).toBeInTheDocument();
		});
	});

	it("lists the Unified Login setup steps when disabled", async () => {
		mockApi({
			"GET /api/instagram/accounts": new Response(
				JSON.stringify({ error: "feature_disabled", message: "off" }),
				{ status: 503, headers: { "Content-Type": "application/json" } },
			),
		});
		renderWithQuery(<InstagramAccounts />);
		await waitFor(() => {
			expect(screen.getAllByText(/INSTAGRAM_CONFIG_ID/).length).toBeGreaterThan(
				0,
			);
		});
		expect(
			screen.getByText("https://jester.vidur.xyz/api/instagram/callback"),
		).toBeInTheDocument();
		expect(screen.getByText(/Unified login/i)).toBeInTheDocument();
	});
});
