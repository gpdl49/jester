"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type {
	MemeDetailDto,
	MemeSummaryDto,
	Paged,
	TagCountDto,
} from "@/lib/api/types";
import type {
	MemeBulkInput,
	MemeListQuery,
	MemePatchInput,
} from "@/lib/memes/schema";
import { api } from "./api";
import { queryKeys } from "./queries";

export async function listMemes(
	query?: MemeListQuery,
	signal?: AbortSignal,
): Promise<Paged<MemeSummaryDto>> {
	return api.get<Paged<MemeSummaryDto>>(
		"/memes",
		query as
			| Record<string, string | number | boolean | null | undefined>
			| undefined,
		signal,
	);
}

export async function getMeme(
	id: string,
	signal?: AbortSignal,
): Promise<MemeDetailDto> {
	return api.get<MemeDetailDto>(`/memes/${id}`, undefined, signal);
}

export async function patchMeme(
	id: string,
	body: MemePatchInput,
): Promise<MemeDetailDto> {
	return api.patch<MemeDetailDto>(`/memes/${id}`, body);
}

export async function deleteMeme(id: string): Promise<void> {
	return api.del(`/memes/${id}`);
}

export async function bulkMemes(
	body: MemeBulkInput,
): Promise<{ updated: number }> {
	return api.post<{ updated: number }>("/memes/bulk", body);
}

export async function listTags(signal?: AbortSignal): Promise<TagCountDto[]> {
	return api.get<TagCountDto[]>("/tags", undefined, signal);
}

export function useMemes(query?: MemeListQuery) {
	return useQuery({
		queryKey: [...queryKeys.memes, query],
		queryFn: ({ signal }) => listMemes(query, signal),
	});
}

export function useInfiniteMemes(query?: Omit<MemeListQuery, "cursor">) {
	return useInfiniteQuery({
		queryKey: [...queryKeys.memes, "infinite", query],
		queryFn: ({ pageParam, signal }) =>
			listMemes({ ...query, cursor: pageParam ?? undefined }, signal),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
	});
}

export function useMeme(id: string) {
	return useQuery({
		queryKey: queryKeys.meme(id),
		queryFn: ({ signal }) => getMeme(id, signal),
		enabled: Boolean(id),
	});
}

export function useTags() {
	return useQuery({
		queryKey: queryKeys.tags,
		queryFn: ({ signal }) => listTags(signal),
		staleTime: 60_000,
	});
}

export function usePatchMeme() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: MemePatchInput }) =>
			patchMeme(id, patch),
		onSuccess: (updated) => {
			queryClient.setQueryData(queryKeys.meme(updated.id), updated);
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function useDeleteMeme() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteMeme(id),
		onSuccess: (_, id) => {
			queryClient.removeQueries({ queryKey: queryKeys.meme(id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function useBulkMemes() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: MemeBulkInput) => bulkMemes(body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}
