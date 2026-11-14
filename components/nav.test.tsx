// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileMenu, TopNav } from "@/components/nav";
import { isActive, navItemsFor } from "@/components/nav-items";
import type { MeDto } from "@/lib/api/types";
import { CurrentUserContext } from "@/lib/client/current-user";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const me = (isAdmin: boolean): MeDto => ({
	id: "u",
	sub: "s",
	email: null,
	username: "u",
	groups: ["memes"],
	isAdmin,
});

afterEach(cleanup);

describe("navigation", () => {
	it("lists Settings only for admins", () => {
		const hrefs = (admin: boolean) => navItemsFor(admin).map((i) => i.href);
		expect(hrefs(false)).toContain("/triage");
		expect(hrefs(false)).not.toContain("/settings");
		expect(hrefs(true)).toContain("/settings");
	});

	it("marks post pages as part of the queue", () => {
		expect(isActive("/posts/abc", "/queue")).toBe(true);
		expect(isActive("/memes/abc", "/memes")).toBe(true);
		expect(isActive("/memes", "/")).toBe(false);
	});

	it.each([
		[me(false), false],
		[null, false],
		[me(true), true],
	])("shows the admin link for %j: %s", (user, shown) => {
		render(
			<CurrentUserContext.Provider value={user}>
				<TopNav />
				<MobileMenu />
			</CurrentUserContext.Provider>,
		);
		expect(
			screen.queryAllByRole("link", { name: "Settings", hidden: true }),
		).toHaveLength(shown ? 2 : 0);
		expect(
			screen.getAllByRole("link", { name: "Activity", hidden: true }),
		).toHaveLength(2);
	});
});
