import {
	DEFAULT_CAPTION_TEMPLATE,
	DEFAULT_UNKNOWN_CREDIT,
	defaultSettings,
	getSetting,
} from "@/lib/settings";

export type CaptionPostInput = {
	caption: string;
	items: {
		meme: {
			creditText: string | null;
			hashtags: string[];
		};
	}[];
};

export type RenderedCaption = {
	text: string;
	warnings: string[];
};

/**
 * Renders the final caption for an Instagram post using the configured
 * caption template and meme attribution credits.
 */
export async function renderCaption(
	post: CaptionPostInput,
): Promise<RenderedCaption> {
	let template = DEFAULT_CAPTION_TEMPLATE;
	let unknownCredit = DEFAULT_UNKNOWN_CREDIT;
	try {
		template = await getSetting("caption.template");
		unknownCredit = await getSetting("caption.unknownCredit");
	} catch {
		const defaults = defaultSettings();
		template = defaults["caption.template"];
		unknownCredit = defaults["caption.unknownCredit"];
	}

	// Collect unique credits and hashtags across items
	const credits: string[] = [];
	const allHashtags: string[] = [];

	for (const item of post.items) {
		if (item.meme.creditText && item.meme.creditText.trim()) {
			credits.push(`📸 ${item.meme.creditText.trim()}`);
		}
		for (const tag of item.meme.hashtags) {
			const cleaned = tag.trim().replace(/^#+/, "");
			if (cleaned && !allHashtags.includes(`#${cleaned}`)) {
				allHashtags.push(`#${cleaned}`);
			}
		}
	}

	const creditBlock = credits.length > 0 ? credits.join("\n") : unknownCredit;
	const hashtagsBlock = allHashtags.join(" ");

	// Replace template tokens
	let text = template
		.replace("{caption}", post.caption.trim())
		.replace("{credit}", creditBlock)
		.replace("{hashtags}", hashtagsBlock);

	// Clean up extra blank lines (more than 2 consecutive newlines)
	text = text.replace(/\n{3,}/g, "\n\n").trim();

	const warnings: string[] = [];
	if (allHashtags.length > 30) {
		warnings.push(
			`Post has ${allHashtags.length} hashtags; Instagram allows at most 30.`,
		);
	}
	if (text.length > 2200) {
		warnings.push(
			`Caption length is ${text.length} characters; Instagram allows at most 2,200.`,
		);
	}

	return { text, warnings };
}
