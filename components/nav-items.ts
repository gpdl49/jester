import {
	Activity,
	CalendarDays,
	Images,
	LayoutDashboard,
	ListOrdered,
	type LucideIcon,
	ScanSearch,
	Settings,
	Upload,
} from "lucide-react";

export type NavItem = {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Shown in the mobile bottom bar (space for about five). */
	primary: boolean;
	/** Only for ADMIN_GROUP. */
	adminOnly?: boolean;
};

/** Pages from docs/jester.md "Pages". */
export const NAV_ITEMS: NavItem[] = [
	{ href: "/", label: "Dashboard", icon: LayoutDashboard, primary: true },
	{ href: "/triage", label: "Triage", icon: ScanSearch, primary: true },
	{ href: "/memes", label: "Library", icon: Images, primary: true },
	{ href: "/queue", label: "Queue", icon: ListOrdered, primary: true },
	{ href: "/calendar", label: "Calendar", icon: CalendarDays, primary: false },
	{ href: "/upload", label: "Upload", icon: Upload, primary: false },
	{ href: "/activity", label: "Activity", icon: Activity, primary: false },
	{
		href: "/settings",
		label: "Settings",
		icon: Settings,
		primary: false,
		adminOnly: true,
	},
];

/** What this user sees: admin pages stay hidden until they are known admin. */
export const navItemsFor = (isAdmin: boolean) =>
	NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);

export function isActive(pathname: string, href: string): boolean {
	return href === "/"
		? pathname === "/"
		: pathname === href ||
				pathname.startsWith(`${href}/`) ||
				(href === "/queue" && pathname.startsWith("/posts/"));
}
