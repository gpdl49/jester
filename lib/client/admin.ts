"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type {
	AiUsageDayDto,
	AuditEventDto,
	DashboardStatsDto,
	Paged,
	SettingsDto,
} from "@/lib/api/types";
import { api } from "./api";
import { queryKeys } from "./queries";

export function useDashboardStats() {
	return useQuery({
		queryKey: queryKeys.stats,
		queryFn: () => api.get<DashboardStatsDto>("/stats"),
		refetchInterval: 15_000,
	});
}

export function useSettings() {
	return useQuery({
		queryKey: queryKeys.settings,
		queryFn: () => api.get<SettingsDto>("/settings"),
	});
}

export function useUpdateSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: Partial<SettingsDto>) =>
			api.patch<SettingsDto>("/settings", patch),
		onSuccess: (updated) => {
			queryClient.setQueryData(queryKeys.settings, updated);
			void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
			void queryClient.invalidateQueries({ queryKey: queryKeys.audit });
		},
	});
}

export function useAuditEvents(params?: {
	cursor?: string;
	action?: string;
	limit?: number;
}) {
	return useQuery({
		queryKey: [
			...queryKeys.audit,
			params?.action,
			params?.cursor,
			params?.limit,
		],
		queryFn: () =>
			api.get<Paged<AuditEventDto>>("/audit", {
				action: params?.action,
				cursor: params?.cursor,
				limit: params?.limit,
			}),
	});
}

/** Audit log pages, newest first; `fetchNextPage` follows `nextCursor`. */
export function useAuditEventPages(params?: {
	action?: string;
	limit?: number;
}) {
	return useInfiniteQuery({
		queryKey: [...queryKeys.audit, "pages", params?.action, params?.limit],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			api.get<Paged<AuditEventDto>>("/audit", {
				action: params?.action,
				cursor: pageParam,
				limit: params?.limit,
			}),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
}

export function useAiUsage(days = 30) {
	return useQuery({
		queryKey: [...queryKeys.aiUsage, days],
		queryFn: () => api.get<AiUsageDayDto[]>("/ai/usage", { days }),
	});
}
