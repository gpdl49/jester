"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Shared TanStack Query keys. Each slice keeps its own hooks in
 * lib/client/<slice>.ts and uses these roots so mutations can invalidate
 * across slices (e.g. approving a meme refreshes the stats).
 */
export const queryKeys = {
	me: ["me"] as const,
	stats: ["stats"] as const,
	triage: ["triage"] as const,
	memes: ["memes"] as const,
	meme: (id: string) => ["memes", id] as const,
	tags: ["tags"] as const,
	posts: ["posts"] as const,
	post: (id: string) => ["posts", id] as const,
	schedule: ["schedule"] as const,
	instagram: ["instagram"] as const,
	settings: ["settings"] as const,
	audit: ["audit"] as const,
	aiUsage: ["ai-usage"] as const,
};

export function useMe() {
	return useQuery({
		queryKey: queryKeys.me,
		queryFn: () => api.me(),
		staleTime: 5 * 60_000,
	});
}
