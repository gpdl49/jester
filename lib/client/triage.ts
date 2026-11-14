"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import type { Paged, TriageCandidateDto, TriageStatus } from "@/lib/api/types";
import { api } from "./api";
import { queryKeys } from "./queries";

export type ListTriageParams = {
	status?: TriageStatus;
	minProbability?: number;
	cursor?: string;
	limit?: number;
};

export async function listTriage(
	params: ListTriageParams = {},
	signal?: AbortSignal,
): Promise<Paged<TriageCandidateDto>> {
	return api.get<Paged<TriageCandidateDto>>("/triage", params, signal);
}

export type TriageDecisionItem = {
	immichAssetId: string;
	decision: "accept" | "reject";
};

export type DecisionsResult = {
	accepted: number;
	rejected: number;
};

export async function postTriageDecisions(
	decisions: TriageDecisionItem[],
	signal?: AbortSignal,
): Promise<DecisionsResult> {
	return api.post<DecisionsResult>(
		"/triage/decisions",
		{ decisions },
		{ signal },
	);
}

export async function postTriageAcceptAbove(
	minProbability: number,
	signal?: AbortSignal,
): Promise<{ accepted: number }> {
	return api.post<{ accepted: number }>(
		"/triage/accept-above",
		{ minProbability },
		{ signal },
	);
}

export async function postTriageReset(
	id: string,
	signal?: AbortSignal,
): Promise<TriageCandidateDto> {
	return api.post<TriageCandidateDto>(
		`/triage/${api.enc(id)}/reset`,
		undefined,
		{
			signal,
		},
	);
}

export function useTriageCandidates(
	params: {
		status?: TriageStatus;
		minProbability?: number;
		limit?: number;
	} = {},
) {
	const status = params.status ?? "scored";
	return useInfiniteQuery({
		queryKey: [
			...queryKeys.triage,
			status,
			params.minProbability,
			params.limit,
		],
		queryFn: ({ pageParam, signal }) =>
			listTriage(
				{
					status,
					minProbability: params.minProbability,
					limit: params.limit,
					cursor: pageParam,
				},
				signal,
			),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

export function useTriageDecisions() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (decisions: TriageDecisionItem[]) =>
			postTriageDecisions(decisions),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.triage });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function useTriageAcceptAbove() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (minProbability: number) =>
			postTriageAcceptAbove(minProbability),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.triage });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}

export function useTriageReset() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => postTriageReset(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.triage });
			queryClient.invalidateQueries({ queryKey: queryKeys.stats });
		},
	});
}
