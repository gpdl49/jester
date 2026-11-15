"use client";

import { AlertTriangle, Camera, CheckCircle2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
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

function Code({ children }: { children: React.ReactNode }) {
	return (
		<code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-fg">
			{children}
		</code>
	);
}

function SetupSteps() {
	return (
		<ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
			<li>
				In the Meta App Dashboard, use the app's "Manage messaging &amp; content
				on Instagram" use case and choose "API setup with Unified login". The
				app must belong to a business portfolio. No Facebook Page is needed.
			</li>
			<li>
				Create a login configuration with the permissions{" "}
				<Code>instagram_basic</Code> and <Code>instagram_content_publish</Code>,
				then "Use this configuration". Copy its configuration ID into{" "}
				<Code>INSTAGRAM_CONFIG_ID</Code>.
			</li>
			<li>
				Set the redirect URL to{" "}
				<Code>https://jester.vidur.xyz/api/instagram/callback</Code>.
			</li>
			<li>
				Put the Meta app ID in <Code>INSTAGRAM_APP_ID</Code> and the app secret
				in <Code>INSTAGRAM_APP_SECRET</Code> (not the Instagram app values).
			</li>
			<li>
				Add the Instagram professional account's owner as a tester while the app
				is in development mode.
			</li>
		</ol>
	);
}

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

	const expiresAt = account.tokenExpiresAt
		? new Date(account.tokenExpiresAt)
		: null;
	const daysLeft = expiresAt
		? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
		: null;
	const isExpiringSoon = daysLeft !== null && daysLeft <= 10;

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
					{account.needsReconnect ? (
						<div className="inline-flex items-center font-medium text-danger">
							<AlertTriangle className="mr-0.5 inline size-3" />
							Meta rejected this account's access token. Click "Connect Account"
							to sign in again.
						</div>
					) : expiresAt && daysLeft !== null ? (
						<div>
							Token expires:{" "}
							<span className={isExpiringSoon ? "font-medium text-danger" : ""}>
								{expiresAt.toLocaleDateString()} (
								{daysLeft > 0 ? `${daysLeft}d left` : "Expired"})
							</span>
							{isExpiringSoon && (
								<span className="ml-1 inline-flex items-center text-danger">
									<AlertTriangle className="mr-0.5 inline size-3" />
									Reconnect before it expires
								</span>
							)}
						</div>
					) : (
						<div>Token does not expire</div>
					)}

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

function ConnectNotice({ needsChoice }: { needsChoice: boolean }) {
	const [outcome, setOutcome] = useState<string | null>(null);
	useEffect(() => {
		setOutcome(new URLSearchParams(window.location.search).get("instagram"));
	}, []);
	let text: string | null = null;
	if (outcome === "no_accounts") {
		text =
			"Login worked, but no Instagram professional account was shared. Switch the account to a Business or Creator account, and pick the business portfolio that owns it when signing in.";
	} else if (outcome === "denied") {
		text = "Instagram login was cancelled.";
	} else if (outcome === "error") {
		text =
			"Meta rejected the login. Check that the redirect URI in the Meta app's Facebook Login for Business settings is exactly https://jester.vidur.xyz/api/instagram/callback, then try again. The server log has the details.";
	} else if (needsChoice) {
		text =
			'Several Instagram accounts are connected. Choose which one publishes with "Make default".';
	}
	if (!text) return null;
	return (
		<p className="mt-4 rounded-lg border border-line bg-sunken p-3 text-sm text-fg">
			{text}
		</p>
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
					Instagram publishing is currently disabled. To enable it, set{" "}
					<Code>INSTAGRAM_APP_ID</Code>, <Code>INSTAGRAM_APP_SECRET</Code>,{" "}
					<Code>INSTAGRAM_CONFIG_ID</Code> and <Code>TOKEN_ENCRYPTION_KEY</Code>{" "}
					in the environment secrets.
				</p>
				<SetupSteps />
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
						Connect Instagram Creator or Business accounts (sign in with
						Instagram or Facebook) to publish scheduled memes.
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
			<ConnectNotice
				needsChoice={
					!!accounts &&
					accounts.length > 1 &&
					!accounts.some((a) => a.isDefault)
				}
			/>

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
