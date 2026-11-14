import type { AttributionPlatform } from "@/lib/api/types";

/**
 * Formats a platform enum into a display name.
 */
export function formatPlatformName(platform: AttributionPlatform | string): string {
	switch (platform.toLowerCase()) {
		case "instagram":
			return "Instagram";
		case "x":
			return "X";
		case "reddit":
			return "Reddit";
		case "tiktok":
			return "TikTok";
		case "tumblr":
			return "Tumblr";
		case "ninegag":
			return "9GAG";
		case "ifunny":
			return "iFunny";
		case "web":
			return "Web";
		case "other":
			return "Web";
		default:
			return platform.charAt(0).toUpperCase() + platform.slice(1);
	}
}

/**
 * Formats credit text according to the contract:
 * "@handle on Platform when there is a handle, else creatorName, else the url host"
 */
export function formatCreditText(candidate: {
	handle?: string | null;
	platform: AttributionPlatform | string;
	creatorName?: string | null;
	url?: string | null;
}): string {
	if (candidate.handle?.trim()) {
		const cleanHandle = candidate.handle.trim().replace(/^@+/, "");
		const platform = formatPlatformName(candidate.platform);
		return `@${cleanHandle} on ${platform}`;
	}

	if (candidate.creatorName?.trim()) {
		return candidate.creatorName.trim();
	}

	if (candidate.url?.trim()) {
		try {
			const parsed = new URL(candidate.url.trim());
			return parsed.hostname.replace(/^www\./i, "");
		} catch {
			return candidate.url.trim();
		}
	}

	return formatPlatformName(candidate.platform);
}
