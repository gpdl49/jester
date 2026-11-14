import type { AnalysisDto, TagCountDto } from "@/lib/api/types";
import { api } from "./api";

/**
 * Triggers a meme analysis or attribution find request.
 */
export async function requestAnalysis(
	memeId: string,
	kind: "meme" | "attribution" = "meme",
): Promise<AnalysisDto> {
	return api.post<AnalysisDto>(`/memes/${memeId}/analyses`, { kind });
}

/**
 * Fetches tag counts across non-rejected memes.
 */
export async function getTags(): Promise<TagCountDto[]> {
	return api.get<TagCountDto[]>("/tags");
}
