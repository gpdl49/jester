"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	PostDetailDto,
	PostSummaryDto,
	SchedulePreviewDto,
	ScheduleSlotDto,
} from "@/lib/api/types";
import { api } from "./api";
import { queryKeys } from "./queries";

export type ListPostsParams = {
	status?: string;
	from?: string;
	to?: string;
	cursor?: string;
	limit?: number;
};

export function usePosts(params?: ListPostsParams) {
	return useQuery({
		queryKey: [...queryKeys.posts, params],
		queryFn: () =>
			api.get<{ items: PostSummaryDto[]; nextCursor: string | null }>(
				"/posts",
				params,
			),
	});
}

export function usePost(id: string) {
	return useQuery({
		queryKey: queryKeys.post(id),
		queryFn: () => api.get<PostDetailDto>(`/posts/${api.enc(id)}`),
		enabled: Boolean(id),
	});
}

export function useCreatePost() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: {
			memeIds: string[];
			caption?: string;
			accountId?: string | null;
			scheduledAt?: string | null;
			status?: "draft" | "queued";
		}) => api.post<PostDetailDto>("/posts", body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.posts });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function usePatchPost(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: {
			caption?: string;
			memeIds?: string[];
			scheduledAt?: string | null;
			status?: "draft" | "queued" | "cancelled";
			altTexts?: (string | null)[];
		}) => api.patch<PostDetailDto>(`/posts/${api.enc(id)}`, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(queryKeys.post(id), updated);
			queryClient.invalidateQueries({ queryKey: queryKeys.posts });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function usePublishNow(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () =>
			api.post<PostDetailDto>(`/posts/${api.enc(id)}/publish-now`),
		onSuccess: (updated) => {
			queryClient.setQueryData(queryKeys.post(id), updated);
			queryClient.invalidateQueries({ queryKey: queryKeys.posts });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function useReorderPosts() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (ids: string[]) => api.post<void>("/posts/reorder", { ids }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.posts });
			queryClient.invalidateQueries({ queryKey: queryKeys.schedule });
		},
	});
}

export function useScheduleSlots() {
	return useQuery({
		queryKey: queryKeys.schedule,
		queryFn: () => api.get<ScheduleSlotDto[]>("/schedule/slots"),
	});
}

export function useUpdateScheduleSlots() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (slots: Omit<ScheduleSlotDto, "id">[]) =>
			api.put<ScheduleSlotDto[]>("/schedule/slots", slots),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.schedule });
		},
	});
}

export function useSchedulePreview(days = 14) {
	return useQuery({
		queryKey: [...queryKeys.schedule, "preview", days],
		queryFn: () => api.get<SchedulePreviewDto>("/schedule/preview", { days }),
	});
}
