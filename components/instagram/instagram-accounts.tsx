"use client";

import { AlertTriangle, Camera, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ErrorText, Loading } from "@/components/ui/feedback";
import type { InstagramAccountDto } from "@/lib/api/types";
import { isApiError } from "@/lib/client/api";
import {
	useDeleteInstagramAccount,
	useInstagramAccounts,
	usePublishingLimit,
	useSetDefaultInstagramAccount,
} from "@/lib/client/instagram";

function AccountRow({
	account,
	onDelete,
	onSetDefault,
	isSettingDefault,
}: {
	account: InstagramAccountDto;
	onDelete: (id: string) => Promise<unknown>;
	onSetDefault: (id: string) => void;
	isSettingDefault: boolean;
}) {
	const { data: limit, isLoading: limitLoading } = usePublishingLimit(
		account.id,
	);

	const expiresAt = new Date(account.tokenExpiresAt);
	const now = new Date();
	const daysLeft = Math.ceil(
		(expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
	);
	const isExpiringSoon = daysLeft <= 10;

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<span className="font-semibold text-fg">@{account.username}</span>
					{account.isDefault ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
							<CheckCircle2 className="size-3" /> Default
						</span>
					) : (
						<Button
							variant="ghost"
							size="sm"
							disabled={isSettingDefault}
							onClick={() => onSetDefault(account.id)}
							className="h-6 px-2 text-xs"
						>
							Make default
						</Button>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
					<div>
						Expires:{" "}
						<span className={isExpiringSoon ? "font-medium text-danger" : ""}>
							{expiresAt.toLocaleDateString()} (
							{daysLeft > 0 ? `${daysLeft}d left` : "Expired"})
						</span>
						{isExpiringSoon && (
							<span className="ml-1 inline-flex items-center text-danger">
								<AlertTriangle className="size-3 mr-0.5 inline" />
								Expiring soon
							</span>
						)}
					</div>

					<div>
						Publishing limit:{" "}
						{limitLoading ? (
							"…"
						) : limit ? (
							<span>
								{limit.used} / {limit.total} used today
							</span>
						) : (
							"unknown"
						)}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2">
				<ConfirmDialog
					trigger={
						<Button variant="danger-ghost" size="sm">
							Disconnect
						</Button>
					}
					title="Disconnect Instagram account?"
					description={`Are you sure you want to disconnect @${account.username}? This will remove publishing credentials.`}
					confirmLabel="Disconnect"
					onConfirm={() => onDelete(account.id)}
				/>
			</div>
		</div>
	);
}

export function InstagramAccounts() {
	const { data: accounts, error, isLoading, refetch } = useInstagramAccounts();
	const deleteMutation = useDeleteInstagramAccount();
	const setDefaultMutation = useSetDefaultInstagramAccount();

	if (isLoading) {
		return <Loading label="Loading Instagram accounts…" />;
	}

	const isFeatureDisabled =
		(error && isApiError(error, 503)) ||
		(error instanceof Error && error.message.includes("not configured"));

	if (isFeatureDisabled) {
		return (
			<div className="rounded-xl border border-line bg-surface p-6">
				<div className="flex items-center gap-2 text-muted">
					<Camera className="size-5" />
					<h3 className="text-base font-semibold text-fg">
						Instagram Publishing
					</h3>
				</div>
				<p className="mt-2 text-sm text-muted">
					Instagram publishing is currently disabled. To enable it, configure{" "}
					<code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-fg">
						INSTAGRAM_APP_ID
					</code>
					,{" "}
					<code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-fg">
						INSTAGRAM_APP_SECRET
					</code>
					, and{" "}
					<code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-fg">
						TOKEN_ENCRYPTION_KEY
					</code>{" "}
					in the environment secrets.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-line bg-surface p-6">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<Camera className="size-5" />
						<h3 className="text-base font-semibold text-fg">
							Instagram Accounts
						</h3>
					</div>
					<p className="mt-1 text-sm text-muted">
						Connect Meta Creator or Business accounts to publish scheduled
						memes.
					</p>
				</div>
				<div>
					<a href="/api/instagram/connect">
						<Button variant="primary" size="sm">
							<Plus className="size-4 mr-1" />
							Connect Account
						</Button>
					</a>
				</div>
			</div>

			<ErrorText error={error} className="mt-4" />

			<div className="mt-6 space-y-3">
				{accounts && accounts.length > 0 ? (
					accounts.map((account) => (
						<AccountRow
							key={account.id}
							account={account}
							onDelete={async (id) => {
								await deleteMutation.mutateAsync(id);
								refetch();
							}}
							onSetDefault={(id) => {
								setDefaultMutation.mutate(id);
							}}
							isSettingDefault={setDefaultMutation.isPending}
						/>
					))
				) : (
					<div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
						No Instagram accounts connected yet. Click "Connect Account" to sign
						in with Instagram.
					</div>
				)}
			</div>
		</div>
	);
}
