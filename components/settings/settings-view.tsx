"use client";

import {
	AlertTriangle,
	Calendar,
	Camera,
	Check,
	MessageSquare,
	Plus,
	ShieldAlert,
	Sliders,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InstagramAccounts } from "@/components/instagram/instagram-accounts";
import { ScheduleSlotsEditor } from "@/components/schedule/schedule-slots-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ErrorText, Loading } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { SettingsDto } from "@/lib/api/types";
import { useSettings, useUpdateSettings } from "@/lib/client/admin";
import { useCurrentUser } from "@/lib/client/current-user";

export function SettingsView() {
	const me = useCurrentUser();
	const { data: settings, isLoading, error } = useSettings();
	const updateMutation = useUpdateSettings();
	const searchParams = useSearchParams();
	const [showConnectedToast, setShowConnectedToast] = useState(false);

	useEffect(() => {
		if (searchParams.get("instagram") === "connected") {
			setShowConnectedToast(true);
		}
	}, [searchParams]);

	if (!me) {
		return <Loading label="Loading settings…" />;
	}

	if (!me.isAdmin) {
		return (
			<div className="mx-auto max-w-2xl py-16 text-center">
				<ShieldAlert className="mx-auto size-12 text-muted" />
				<h2 className="mt-4 text-xl font-semibold text-fg">Admins only</h2>
				<p className="mt-2 text-sm text-muted">
					You need the{" "}
					<code className="rounded bg-sunken px-1.5 py-0.5 font-mono">
						jester-admin
					</code>{" "}
					group to view and change application settings.
				</p>
			</div>
		);
	}

	if (isLoading) {
		return <Loading label="Loading settings…" />;
	}

	if (error || !settings) {
		return <ErrorText error={error ?? "Failed to load settings"} />;
	}

	return (
		<div className="space-y-8 pb-12">
			{showConnectedToast && (
				<div
					role="status"
					className="flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
				>
					<div className="flex items-center gap-2 font-medium">
						<Check className="size-4" />
						Instagram account connected successfully!
					</div>
					<button
						type="button"
						onClick={() => setShowConnectedToast(false)}
						className="text-xs hover:underline"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* Instagram Accounts Section */}
			<section className="space-y-3">
				<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
					<Camera className="size-5 text-accent" />
					Instagram Integration
				</h2>
				<InstagramAccounts />
			</section>

			{/* Posting Schedule Section */}
			<section className="space-y-3">
				<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
					<Calendar className="size-5 text-accent" />
					Posting Schedule
				</h2>
				<ScheduleSlotsEditor />
			</section>

			{/* Triage & Prefilter Settings */}
			<TriageSection
				settings={settings}
				onUpdate={(patch) => updateMutation.mutateAsync(patch)}
			/>

			{/* Immich Smart Search Queries */}
			<SmartQueriesSection
				settings={settings}
				onUpdate={(patch) => updateMutation.mutateAsync(patch)}
			/>

			{/* Caption & Credit Template */}
			<CaptionSection
				settings={settings}
				onUpdate={(patch) => updateMutation.mutateAsync(patch)}
			/>

			{/* AI Budget & Pause */}
			<AiSection
				settings={settings}
				onUpdate={(patch) => updateMutation.mutateAsync(patch)}
			/>

			{/* Kill Switches */}
			<KillSwitchesSection
				settings={settings}
				onUpdate={(patch) => updateMutation.mutateAsync(patch)}
			/>
		</div>
	);
}

function TriageSection({
	settings,
	onUpdate,
}: {
	settings: SettingsDto;
	onUpdate: (patch: Partial<SettingsDto>) => Promise<unknown>;
}) {
	const [prefilterThreshold, setPrefilterThreshold] = useState(
		settings["prefilter.threshold"],
	);
	const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(
		settings["triage.autoAcceptThreshold"] !== null,
	);
	const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(
		settings["triage.autoAcceptThreshold"] ?? 0.9,
	);
	const [saved, setSaved] = useState(false);

	async function handleSave() {
		await onUpdate({
			"prefilter.threshold": prefilterThreshold,
			"triage.autoAcceptThreshold": autoAcceptEnabled
				? autoAcceptThreshold
				: null,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-6">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
					<Sliders className="size-5 text-accent" />
					Triage & Prefilter Thresholds
				</h2>
				{saved && (
					<span className="text-xs text-success flex items-center gap-1">
						<Check className="size-3.5" /> Saved
					</span>
				)}
			</div>

			<div className="space-y-4">
				<Field
					label={
						<div className="flex justify-between items-center">
							<span>Prefilter Score Threshold</span>
							<span className="font-mono text-xs text-muted">
								{prefilterThreshold.toFixed(2)}
							</span>
						</div>
					}
					hint="Minimum score (0 to 1) from filename, dimensions and OCR signals required to send an Immich photo to the AI triage model."
				>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prefilterThreshold}
						onChange={(e) =>
							setPrefilterThreshold(Number.parseFloat(e.target.value))
						}
						className="w-full accent-accent cursor-pointer"
					/>
				</Field>

				<div className="rounded-xl border border-line bg-sunken/40 p-4 space-y-4">
					<label className="flex items-center gap-3 cursor-pointer">
						<input
							type="checkbox"
							checked={autoAcceptEnabled}
							onChange={(e) => setAutoAcceptEnabled(e.target.checked)}
							className="size-4 rounded border-line text-accent focus:ring-accent"
						/>
						<span className="text-sm font-medium text-fg">
							Enable Auto-Accept for high-confidence jester
						</span>
					</label>

					{autoAcceptEnabled && (
						<div className="space-y-3 pt-2">
							<div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger flex items-start gap-2">
								<AlertTriangle className="size-4 shrink-0 mt-0.5" />
								<div>
									<strong>Permanent Deletion Warning:</strong> Accepted jester
									are imported to S3 and then{" "}
									<strong>permanently deleted from Immich</strong>. Auto-accept
									will bypass human review and trigger automatic deletion for
									assets scoring above this threshold.
								</div>
							</div>

							<Field
								label={
									<div className="flex justify-between items-center">
										<span>Auto-Accept Probability Threshold</span>
										<span className="font-mono text-xs text-muted">
											{autoAcceptThreshold.toFixed(2)}
										</span>
									</div>
								}
								hint="Assets with AI meme probability at or above this score (0.5 to 1.0) will be accepted automatically."
							>
								<input
									type="range"
									min={0.5}
									max={1.0}
									step={0.01}
									value={autoAcceptThreshold}
									onChange={(e) =>
										setAutoAcceptThreshold(Number.parseFloat(e.target.value))
									}
									className="w-full accent-accent cursor-pointer"
								/>
							</Field>
						</div>
					)}
				</div>
			</div>

			<Button variant="primary" size="sm" onClick={handleSave}>
				Save Triage Settings
			</Button>
		</section>
	);
}

function SmartQueriesSection({
	settings,
	onUpdate,
}: {
	settings: SettingsDto;
	onUpdate: (patch: Partial<SettingsDto>) => Promise<unknown>;
}) {
	const [queries, setQueries] = useState<string[]>(
		settings["immich.smartQueries"] ?? [],
	);
	const [newQuery, setNewQuery] = useState("");
	const [saved, setSaved] = useState(false);

	function addQuery() {
		const trimmed = newQuery.trim();
		if (!trimmed || queries.includes(trimmed)) return;
		setQueries([...queries, trimmed]);
		setNewQuery("");
	}

	function removeQuery(index: number) {
		setQueries(queries.filter((_, i) => i !== index));
	}

	async function handleSave() {
		await onUpdate({ "immich.smartQueries": queries });
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
						<Sliders className="size-5 text-accent" />
						Immich Smart-Search Queries
					</h2>
					<p className="text-sm text-muted">
						Semantic CLIP queries run against Immich to surface candidate jester
						during sync.
					</p>
				</div>
				{saved && (
					<span className="text-xs text-success flex items-center gap-1">
						<Check className="size-3.5" /> Saved
					</span>
				)}
			</div>

			<div className="flex gap-2">
				<Input
					placeholder="Add a search query (e.g. 'funny meme with impact font')"
					value={newQuery}
					onChange={(e) => setNewQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							addQuery();
						}
					}}
				/>
				<Button
					variant="secondary"
					size="md"
					onClick={addQuery}
					disabled={!newQuery.trim()}
				>
					<Plus className="size-4" /> Add
				</Button>
			</div>

			<ul className="space-y-2 max-h-60 overflow-y-auto">
				{queries.map((q, idx) => (
					<li
						key={q}
						className="flex items-center justify-between rounded-lg border border-line bg-sunken/30 px-3 py-2 text-sm"
					>
						<span className="text-fg font-mono text-xs">{q}</span>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => removeQuery(idx)}
							aria-label={`Remove query ${q}`}
							className="size-7 text-muted hover:text-danger"
						>
							<Trash2 className="size-3.5" />
						</Button>
					</li>
				))}
			</ul>

			<Button variant="primary" size="sm" onClick={handleSave}>
				Save Smart Queries
			</Button>
		</section>
	);
}

function CaptionSection({
	settings,
	onUpdate,
}: {
	settings: SettingsDto;
	onUpdate: (patch: Partial<SettingsDto>) => Promise<unknown>;
}) {
	const [template, setTemplate] = useState(settings["caption.template"]);
	const [unknownCredit, setUnknownCredit] = useState(
		settings["caption.unknownCredit"],
	);
	const [saved, setSaved] = useState(false);

	const isValid = template.includes("{caption}");

	const sampleCaption = "When all tests pass on the first try";
	const sampleCredit = "📸 @sample_creator";
	const sampleHashtags = "#jester #programming #devhumor";

	const livePreview = template
		.replace("{caption}", sampleCaption)
		.replace("{credit}", sampleCredit)
		.replace("{hashtags}", sampleHashtags);

	const fallbackLivePreview = template
		.replace("{caption}", sampleCaption)
		.replace("{credit}", unknownCredit)
		.replace("{hashtags}", sampleHashtags);

	async function handleSave() {
		if (!isValid) return;
		await onUpdate({
			"caption.template": template,
			"caption.unknownCredit": unknownCredit,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-5">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
					<MessageSquare className="size-5 text-accent" />
					Captions & Credits
				</h2>
				{saved && (
					<span className="text-xs text-success flex items-center gap-1">
						<Check className="size-3.5" /> Saved
					</span>
				)}
			</div>

			<Field
				htmlFor="caption-template"
				label="Caption Template"
				hint="Template for generated Instagram captions. Must contain {caption}; {credit} and {hashtags} are optional placeholders."
			>
				<Textarea
					id="caption-template"
					value={template}
					onChange={(e) => setTemplate(e.target.value)}
					className="font-mono text-sm min-h-24"
				/>
				{!isValid && (
					<p className="text-xs text-danger mt-1">
						Template must contain the placeholder {"{caption}"}.
					</p>
				)}
			</Field>

			<Field
				htmlFor="unknown-credit"
				label="Unknown Creator Fallback Text"
				hint="Credit text used when attribution is unknown or unconfirmed."
			>
				<Input
					id="unknown-credit"
					value={unknownCredit}
					onChange={(e) => setUnknownCredit(e.target.value)}
				/>
			</Field>

			{/* Live Sample Render */}
			<div className="rounded-xl border border-line bg-sunken/40 p-4 space-y-3">
				<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
					Live Preview Sample
				</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-lg border border-line bg-surface p-3 space-y-1">
						<span className="text-xs font-medium text-accent">
							With Confirmed Creator:
						</span>
						<pre className="whitespace-pre-wrap font-sans text-xs text-fg leading-relaxed">
							{livePreview}
						</pre>
					</div>
					<div className="rounded-lg border border-line bg-surface p-3 space-y-1">
						<span className="text-xs font-medium text-muted">
							With Unknown Creator:
						</span>
						<pre className="whitespace-pre-wrap font-sans text-xs text-fg leading-relaxed">
							{fallbackLivePreview}
						</pre>
					</div>
				</div>
			</div>

			<Button
				variant="primary"
				size="sm"
				onClick={handleSave}
				disabled={!isValid}
			>
				Save Caption Settings
			</Button>
		</section>
	);
}

function AiSection({
	settings,
	onUpdate,
}: {
	settings: SettingsDto;
	onUpdate: (patch: Partial<SettingsDto>) => Promise<unknown>;
}) {
	const [dailyBudget, setDailyBudget] = useState(settings["ai.dailyBudgetUsd"]);
	const [paused, setPaused] = useState(settings["ai.paused"]);
	const [saved, setSaved] = useState(false);

	async function handleSave() {
		await onUpdate({
			"ai.dailyBudgetUsd": dailyBudget,
			"ai.paused": paused,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	return (
		<section className="rounded-2xl border border-line bg-surface p-6 space-y-5">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-fg flex items-center gap-2">
					<Sparkles className="size-5 text-accent" />
					AI Configuration & Spend
				</h2>
				{saved && (
					<span className="text-xs text-success flex items-center gap-1">
						<Check className="size-3.5" /> Saved
					</span>
				)}
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					htmlFor="daily-budget"
					label="Daily Budget (USD)"
					hint="Maximum AI spend allowed per UTC day across triage, analysis and attribution."
				>
					<Input
						id="daily-budget"
						type="number"
						min={0}
						max={100}
						step={0.5}
						value={dailyBudget}
						onChange={(e) =>
							setDailyBudget(Number.parseFloat(e.target.value) || 0)
						}
					/>
				</Field>

				<div className="flex flex-col justify-end">
					<label className="flex items-center gap-3 cursor-pointer rounded-lg border border-line p-3 bg-sunken/30">
						<input
							type="checkbox"
							checked={paused}
							onChange={(e) => setPaused(e.target.checked)}
							className="size-4 rounded border-line text-accent focus:ring-accent"
						/>
						<div>
							<div className="text-sm font-medium text-fg">
								Pause all AI calls
							</div>
							<div className="text-xs text-muted">
								Immediately stops automated triage, meme analysis, and
								attribution search.
							</div>
						</div>
					</label>
				</div>
			</div>

			<Button variant="primary" size="sm" onClick={handleSave}>
				Save AI Settings
			</Button>
		</section>
	);
}

function KillSwitchesSection({
	settings,
	onUpdate,
}: {
	settings: SettingsDto;
	onUpdate: (patch: Partial<SettingsDto>) => Promise<unknown>;
}) {
	return (
		<section className="rounded-2xl border border-danger/30 bg-danger-soft/20 p-6 space-y-4">
			<h2 className="text-lg font-semibold text-danger flex items-center gap-2">
				<AlertTriangle className="size-5" />
				Emergency Kill Switches
			</h2>
			<p className="text-sm text-muted">
				Global emergency controls to instantly halt irreversible background
				operations.
			</p>

			<div className="grid gap-4 sm:grid-cols-2">
				{/* Immich Deletion Kill Switch */}
				<div className="rounded-xl border border-line bg-surface p-4 flex flex-col justify-between gap-4">
					<div>
						<div className="flex items-center justify-between">
							<span className="font-medium text-fg">
								Immich Photo Deletions
							</span>
							<span
								className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
									settings["immich.deletePaused"]
										? "bg-danger-soft text-danger"
										: "bg-success/20 text-success"
								}`}
							>
								{settings["immich.deletePaused"] ? "PAUSED" : "ACTIVE"}
							</span>
						</div>
						<p className="mt-1 text-xs text-muted">
							When paused, accepted photos are safe in S3 but will not be
							deleted from Immich.
						</p>
					</div>

					<ConfirmDialog
						trigger={
							<Button
								variant={
									settings["immich.deletePaused"] ? "secondary" : "danger"
								}
								size="sm"
							>
								{settings["immich.deletePaused"]
									? "Resume Deletion"
									: "Pause Immich Deletions"}
							</Button>
						}
						title={
							settings["immich.deletePaused"]
								? "Resume Immich Deletion"
								: "Pause Immich Deletion"
						}
						description={
							settings["immich.deletePaused"]
								? "Are you sure you want to resume deleting accepted photos from Immich?"
								: "Are you sure you want to halt all photo deletions from Immich? Deletion jobs will record events as skipped."
						}
						confirmLabel={
							settings["immich.deletePaused"] ? "Resume" : "Pause Deletions"
						}
						onConfirm={() =>
							onUpdate({
								"immich.deletePaused": !settings["immich.deletePaused"],
							})
						}
					/>
				</div>

				{/* Publishing Kill Switch */}
				<div className="rounded-xl border border-line bg-surface p-4 flex flex-col justify-between gap-4">
					<div>
						<div className="flex items-center justify-between">
							<span className="font-medium text-fg">Instagram Publishing</span>
							<span
								className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
									settings["publishing.paused"]
										? "bg-danger-soft text-danger"
										: "bg-success/20 text-success"
								}`}
							>
								{settings["publishing.paused"] ? "PAUSED" : "ACTIVE"}
							</span>
						</div>
						<p className="mt-1 text-xs text-muted">
							When paused, scheduled posts remain in queue and will not be
							published to Instagram.
						</p>
					</div>

					<ConfirmDialog
						trigger={
							<Button
								variant={settings["publishing.paused"] ? "secondary" : "danger"}
								size="sm"
							>
								{settings["publishing.paused"]
									? "Resume Publishing"
									: "Pause Instagram Publishing"}
							</Button>
						}
						title={
							settings["publishing.paused"]
								? "Resume Publishing"
								: "Pause Instagram Publishing"
						}
						description={
							settings["publishing.paused"]
								? "Are you sure you want to resume publishing queued posts to Instagram?"
								: "Are you sure you want to pause all publishing to Instagram? Scheduled slots will be skipped."
						}
						confirmLabel={
							settings["publishing.paused"] ? "Resume" : "Pause Publishing"
						}
						onConfirm={() =>
							onUpdate({
								"publishing.paused": !settings["publishing.paused"],
							})
						}
					/>
				</div>
			</div>
		</section>
	);
}
