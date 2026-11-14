import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, MobileMenu, TopNav } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
	title: { default: "Memes", template: "%s · Memes" },
	description: "Meme curation and Instagram scheduling.",
	applicationName: "Memes",
	appleWebApp: { capable: true, title: "Memes", statusBarStyle: "default" },
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
					<header className="print:hidden sticky top-0 z-10 border-b border-neutral-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
						<div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
							<Link href="/" className="font-semibold tracking-tight">
								Memes
							</Link>
							<TopNav />
							<a
								href="/oauth2/sign_out"
								className="hidden text-sm text-neutral-500 hover:underline md:block"
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
