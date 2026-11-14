"use client";

import { AlertCircle, AlertTriangle, Hash, Type } from "lucide-react";
import { useMemo } from "react";
import { Field, Textarea } from "@/components/ui/field";

export type CaptionEditorItem = {
	meme: {
		creditText: string | null;
		hashtags?: string[];
		tags?: { name: string }[];
		sensitivity?: unknown;
	};
};

export type CaptionEditorProps = {
	caption: string;
	onChange: (value: string) => void;
	items: CaptionEditorItem[];
	template?: string;
	unknownCredit?: string;
	readOnly?: boolean;
};

const DEFAULT_TEMPLATE = "{caption}\n\n{credit}\n\n{hashtags}";
const DEFAULT_UNKNOWN_CREDIT = "Creator unknown — DM for credit/removal";
const MAX_CHARS = 2200;
const MAX_TAGS = 30;

export function CaptionEditor({
	caption,
	onChange,
	items,
	template = DEFAULT_TEMPLATE,
	unknownCredit = DEFAULT_UNKNOWN_CREDIT,
	readOnly = false,
}: CaptionEditorProps) {
	const { rendered, charCount, hashtagCount, warnings } = useMemo(() => {
		const warns: string[] = [];

		// 1. Credits
		const confirmedCredits = items
			.map((item) => item.meme.creditText?.trim())
			.filter((c): c is string => Boolean(c && c.length > 0));
		const dedupedCredits = Array.from(new Set(confirmedCredits));

		let creditStr = "";
		if (dedupedCredits.length > 0) {
			creditStr = dedupedCredits.map((c) => `📸 ${c}`).join(" · ");
		} else {
			creditStr = unknownCredit;
		}

		if (items.length === 0 || items.some((i) => !i.meme.creditText?.trim())) {
			warns.push("Unknown creator");
		}

		// 2. Hashtags
		const allTags: string[] = [];
		for (const item of items) {
			const sourceTags =
				item.meme.hashtags ?? item.meme.tags?.map((t) => t.name) ?? [];
			for (const h of sourceTags) {
				const cleaned = h.trim().replace(/^#+/, "");
				if (cleaned) {
					const norm = `#${cleaned}`;
					if (!allTags.includes(norm)) {
						allTags.push(norm);
					}
				}
			}
		}

		if (allTags.length > MAX_TAGS) {
			warns.push("Hashtags trimmed to 30");
		}
		const finalTags = allTags.slice(0, MAX_TAGS);
		const hashtagsStr = finalTags.join(" ");

		// 3. Sensitivity
		const anySensitive = items.some((item) => {
			const s = item.meme.sensitivity as Record<string, unknown> | null;
			return Boolean(s && (s.nsfw || s.politics || s.slurs || s.personalData));
		});
		if (anySensitive) {
			warns.push("Post contains sensitive content");
		}

		// 4. Render
		const uncollapsed = template
			.replace("{caption}", caption)
			.replace("{credit}", creditStr)
			.replace("{hashtags}", hashtagsStr);

		const renderedText = uncollapsed.replace(/\n{3,}/g, "\n\n").trim();
		const chars = renderedText.length;

		if (chars > MAX_CHARS) {
			warns.push("Caption exceeds 2,200 characters (truncated)");
		}

		return {
			rendered: renderedText,
			charCount: chars,
			hashtagCount: allTags.length,
			warnings: warns,
		};
	}, [caption, items, template, unknownCredit]);

	const isCharOver = charCount > MAX_CHARS;
	const isTagOver = hashtagCount > MAX_TAGS;

	return (
		<div className="space-y-4">
			<Field label="Caption Draft" htmlFor="post-caption-input">
				<Textarea
					id="post-caption-input"
					value={caption}
					onChange={(e) => onChange(e.target.value)}
					disabled={readOnly}
					placeholder="Write your post caption..."
					className="min-h-32 text-sm"
				/>
			</Field>

			{/* Counters */}
			<div className="flex flex-wrap items-center justify-between gap-3 text-xs">
				<div className="flex items-center gap-4">
					<div
						className={`flex items-center gap-1 font-mono font-medium ${
							isCharOver ? "text-danger" : "text-faint"
						}`}
						data-testid="char-counter"
					>
						<Type className="size-3.5" />
						<span>
							{charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
						</span>
					</div>

					<div
						className={`flex items-center gap-1 font-mono font-medium ${
							isTagOver ? "text-danger" : "text-faint"
						}`}
						data-testid="tag-counter"
					>
						<Hash className="size-3.5" />
						<span>
							{hashtagCount} / {MAX_TAGS} tags
						</span>
					</div>
				</div>

				{warnings.length > 0 && (
					<div
						className="flex items-center gap-1 text-amber-500 font-medium"
						data-testid="caption-warnings-badge"
					>
						<AlertTriangle className="size-3.5" />
						<span>
							{warnings.length} warning{warnings.length > 1 ? "s" : ""}
						</span>
					</div>
				)}
			</div>

			{/* Warnings List */}
			{warnings.length > 0 && (
				<div className="space-y-1.5" data-testid="caption-warnings-list">
					{warnings.map((w) => (
						<div
							key={w}
							className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400"
						>
							<AlertCircle className="size-3.5 shrink-0" />
							<span>{w}</span>
						</div>
					))}
				</div>
			)}

			{/* Rendered Live Preview */}
			<div className="rounded-lg border border-line bg-canvas/60 p-3.5">
				<div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
					Rendered Instagram Caption
				</div>
				<p
					className="whitespace-pre-wrap text-sm leading-relaxed text-fg select-text"
					data-testid="rendered-caption-preview"
				>
					{rendered || <span className="italic text-faint">Empty caption</span>}
				</p>
			</div>
		</div>
	);
}
