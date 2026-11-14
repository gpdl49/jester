"use client";

import { Camera } from "lucide-react";

export function InstagramAccountsPlaceholder() {
	return (
		<div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
			<div className="flex items-center gap-2 font-medium text-fg">
				<Camera className="size-4" />
				Instagram Accounts
			</div>
			<p className="mt-1">
				Instagram account management is handled by the instagram slice. Connect
				your creator account to enable scheduled publishing.
			</p>
		</div>
	);
}
