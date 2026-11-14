/**
 * Clue extraction from meme OCR text, meme analysis results, and file names.
 * Extracts handles, subreddits, sites, watermarks, and classifies known reposters.
 */

export const KNOWN_REPOSTERS = [
	"9gag",
	"ifunny",
	"memes",
	"pubity",
	"fuckjerry",
	"daquan",
	"ladbible",
	"theshaderoom",
	"epicfunnypage",
	"sarcasm_only",
	"cheezburger",
	"funnyordie",
	"buzzfeed",
	"meirl",
	"shitpost",
	"dankmemes",
	"meme",
	"barstoolsports",
	"worldstar",
] as const;

const REPOSTER_SET = new Set(KNOWN_REPOSTERS.map((r) => r.toLowerCase()));

/** Checks if a handle, username, or platform domain is a known meme aggregator / reposter. */
export function isReposter(nameOrHandle: string): boolean {
	const normalized = normalizeHandle(nameOrHandle).toLowerCase();
	if (REPOSTER_SET.has(normalized)) {
		return true;
	}
	// Also check if domain contains known reposter (e.g. 9gag.com, ifunny.co)
	for (const reposter of KNOWN_REPOSTERS) {
		if (
			normalized === reposter ||
			normalized.startsWith(`${reposter}.`) ||
			normalized.endsWith(`.${reposter}`)
		) {
			return true;
		}
	}
	return false;
}

export type CluesInput = {
	ocrText?: string | null;
	analysisClues?: {
		watermarks?: string[];
		handles?: string[];
		sites?: string[];
		subreddits?: string[];
	} | null;
	originalFileName?: string | null;
};

export type ExtractedClues = {
	handles: string[];
	subreddits: string[];
	sites: string[];
	watermarks: string[];
	reposters: string[];
};

/** Normalizes a handle by removing leading @ or u/, trailing punctuation, and emojis. */
export function normalizeHandle(raw: string): string {
	if (!raw) return "";
	let s = raw.trim();
	// Strip leading @ or u/ or /u/
	s = s.replace(/^@+/, "").replace(/^\/?u\//i, "");
	// Strip trailing punctuation: dots, commas, exclamation marks, question marks, colons, quotes, etc.
	s = s.replace(/[.,:;!?)"'\]}]+$/, "");
	// Strip emojis and non-standard symbols from edges
	s = s.replace(/^[^\w]+/, "").replace(/[^\w.-]+$/, "");
	// Strip any remaining trailing dots or dashes
	s = s.replace(/[.-]+$/, "");
	return s.trim();
}

/** Normalizes a subreddit by removing leading r/ or /r/ and trailing punctuation. */
export function normalizeSubreddit(raw: string): string {
	if (!raw) return "";
	let s = raw.trim();
	s = s.replace(/^\/?r\//i, "");
	s = s.replace(/[.,:;!?)"'\]}]+$/, "");
	s = s.replace(/^[^\w]+/, "").replace(/[^\w]+$/, "");
	return s.trim().toLowerCase();
}

/** Normalizes a site or domain. */
export function normalizeSite(raw: string): string {
	if (!raw) return "";
	let s = raw.trim().toLowerCase();
	// Remove protocol
	s = s.replace(/^https?:\/\//i, "");
	// Remove leading www.
	s = s.replace(/^www\./i, "");
	// Remove trailing slash and path
	s = s.split("/")[0] ?? s;
	s = s.split("?")[0] ?? s;
	s = s.replace(/[.,:;!?)"'\]}]+$/, "");
	return s.trim();
}

/** Normalizes a watermark text. */
export function normalizeWatermark(raw: string): string {
	if (!raw) return "";
	return raw.trim().replace(/[.,:;!?)"'\]}]+$/, "");
}

/**
 * Extracts and deduplicates clues from meme signals.
 */
export function extractClues(input: CluesInput): ExtractedClues {
	const handlesSet = new Set<string>();
	const subredditsSet = new Set<string>();
	const sitesSet = new Set<string>();
	const watermarksSet = new Set<string>();
	const repostersSet = new Set<string>();

	function addHandle(raw: string) {
		const h = normalizeHandle(raw);
		if (h && h.length > 1 && !/^\d+$/.test(h)) {
			handlesSet.add(h);
			if (isReposter(h)) {
				repostersSet.add(h.toLowerCase());
			}
		}
	}

	function addSubreddit(raw: string) {
		const sub = normalizeSubreddit(raw);
		if (sub && sub.length > 1) {
			subredditsSet.add(sub);
			if (isReposter(sub)) {
				repostersSet.add(sub.toLowerCase());
			}
		}
	}

	function addSite(raw: string) {
		const site = normalizeSite(raw);
		if (site?.includes(".") && site.length > 3) {
			sitesSet.add(site);
			if (isReposter(site)) {
				repostersSet.add(site.toLowerCase());
			}
		}
	}

	function addWatermark(raw: string) {
		const wm = normalizeWatermark(raw);
		if (wm && wm.length > 1) {
			watermarksSet.add(wm);
			if (isReposter(wm)) {
				repostersSet.add(wm.toLowerCase());
			}
		}
	}

	// 1. Clues from OCR text
	if (input.ocrText) {
		const text = input.ocrText;

		// Extract @handles
		const handleMatches = text.matchAll(/(?:^|[\s([{"'])@([A-Za-z0-9_.-]+)/g);
		for (const match of handleMatches) {
			if (match[1]) addHandle(match[1]);
		}

		// Extract Reddit u/handles
		const userMatches = text.matchAll(
			/(?:^|[\s([{"'])\/?u\/([A-Za-z0-9_.-]+)/gi,
		);
		for (const match of userMatches) {
			if (match[1]) addHandle(match[1]);
		}

		// Extract subreddits r/subreddit
		const subMatches = text.matchAll(/(?:^|[\s([{"'])\/?r\/([A-Za-z0-9_]+)/gi);
		for (const match of subMatches) {
			if (match[1]) addSubreddit(match[1]);
		}

		// Extract domains/URLs
		const siteMatches = text.matchAll(
			/(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9-]+\.(?:com|org|net|co|io|xyz|app|me|gg|tv|cc|us|uk|de|ru|fr))[^\s]*/gi,
		);
		for (const match of siteMatches) {
			if (match[1]) addSite(match[1]);
		}

		// Look for watermark patterns in lines
		const lines = text.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (
				/watermark|made with|via\s+|posted by|posted in|imgflip|mematic|kapwing|reddit|9gag|ifunny/i.test(
					trimmed,
				) &&
				trimmed.length < 80
			) {
				addWatermark(trimmed);
			}
		}
	}

	// 2. Clues from previous analysis result
	if (input.analysisClues) {
		for (const h of input.analysisClues.handles ?? []) addHandle(h);
		for (const s of input.analysisClues.subreddits ?? []) addSubreddit(s);
		for (const site of input.analysisClues.sites ?? []) addSite(site);
		for (const wm of input.analysisClues.watermarks ?? []) addWatermark(wm);
	}

	// 3. Clues from original filename (e.g. Immich asset)
	if (input.originalFileName) {
		const fn = input.originalFileName;

		// Reddit filename: reddit_SubredditName_postid or reddit_SubredditName
		const redditMatch = fn.match(/^reddit_([A-Za-z0-9]+)/i);
		if (redditMatch?.[1]) {
			addSubreddit(redditMatch[1]);
			addSite("reddit.com");
		}

		// Facebook image: FB_IMG_...
		if (/FB_IMG/i.test(fn)) {
			addSite("facebook.com");
		}

		// WhatsApp image: -WA\d+ or IMG-...-WA
		if (/-WA\d+/i.test(fn) || /IMG.*WA/i.test(fn)) {
			addWatermark("WhatsApp");
		}

		// 9GAG filename: 9gag_...
		if (/9gag/i.test(fn)) {
			addSite("9gag.com");
			addHandle("9gag");
			repostersSet.add("9gag");
		}

		// iFunny filename: ifunny_...
		if (/ifunny/i.test(fn)) {
			addSite("ifunny.co");
			addHandle("ifunny");
			repostersSet.add("ifunny");
		}

		// Twitter filename: twitter_...
		if (/twitter_/i.test(fn)) {
			addSite("x.com");
		}

		// Instagram filename: instagram_... or IG_...
		if (/instagram_|IG_\d+/i.test(fn)) {
			addSite("instagram.com");
		}
	}

	// Deduplicate case-insensitively while preserving readable formatting
	const dedup = (arr: string[]) => {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const item of arr) {
			const key = item.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				result.push(item);
			}
		}
		return result;
	};

	return {
		handles: dedup(Array.from(handlesSet)),
		subreddits: dedup(Array.from(subredditsSet)),
		sites: dedup(Array.from(sitesSet)),
		watermarks: dedup(Array.from(watermarksSet)),
		reposters: dedup(Array.from(repostersSet)),
	};
}
