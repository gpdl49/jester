"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, NAV_ITEMS, navItemsFor } from "@/components/nav-items";
import { useCurrentUser } from "@/lib/client/current-user";

/** Top navigation on wider screens. */
export function TopNav() {
	const pathname = usePathname();
	const me = useCurrentUser();
	return (
		<nav aria-label="Main" className="hidden gap-1 md:flex">
			{navItemsFor(me?.isAdmin ?? false).map(({ href, label }) => (
				<Link
					key={href}
					href={href}
					aria-current={isActive(pathname, href) ? "page" : undefined}
					className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors text-muted hover:text-fg hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:text-fg aria-[current=page]:font-semibold"
				>
					{label}
				</Link>
			))}
		</nav>
	);
}

/** Bottom tab bar on phones; the remaining pages are in the header menu. */
export function BottomNav() {
	const pathname = usePathname();
	return (
		<nav
			aria-label="Main"
			className="print:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
		>
			{NAV_ITEMS.filter((item) => item.primary).map(
				({ href, label, icon: Icon }) => (
					<Link
						key={href}
						href={href}
						aria-current={isActive(pathname, href) ? "page" : undefined}
						className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted transition-colors hover:text-fg aria-[current=page]:text-accent aria-[current=page]:font-semibold"
					>
						<Icon aria-hidden className="size-5" />
						{label}
					</Link>
				),
			)}
		</nav>
	);
}

/** Secondary pages on phones. */
export function MobileMenu() {
	const me = useCurrentUser();
	return (
		<details className="relative md:hidden">
			<summary className="cursor-pointer list-none rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-fg hover:bg-sunken transition-colors">
				More
			</summary>
			<div className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-xl border border-line bg-raised p-1 shadow-xl">
				{navItemsFor(me?.isAdmin ?? false)
					.filter((item) => !item.primary)
					.map(({ href, label }) => (
						<Link
							key={href}
							href={href}
							className="rounded-lg px-3 py-2 text-sm text-fg transition-colors hover:bg-sunken"
						>
							{label}
						</Link>
					))}
				<a
					href="/oauth2/sign_out"
					className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-sunken hover:text-fg"
				>
					Sign out
				</a>
			</div>
		</details>
	);
}
