import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, MobileMenu, TopNav } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
	title: { default: "Jester", template: "%s · Jester" },
	description: "Meme curation and Instagram scheduling.",
	applicationName: "Jester",
	appleWebApp: { capable: true, title: "Jester", statusBarStyle: "default" },
	robots: { index: false, follow: false },
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#fafafa" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
	],
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-dvh">
				<Providers>
					<header className="print:hidden sticky top-0 z-10 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
						<div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
							<Link
								href="/"
								className="font-semibold tracking-tight text-fg text-lg"
							>
								Jester
							</Link>
							<TopNav />
							<a
								href="/oauth2/sign_out"
								className="hidden text-sm text-muted hover:text-fg hover:underline md:block"
							>
								Sign out
							</a>
							<MobileMenu />
						</div>
					</header>
					<main className="mx-auto max-w-7xl px-4 py-6 pb-24 md:pb-6">
						{children}
					</main>
					<BottomNav />
				</Providers>
			</body>
		</html>
	);
}
