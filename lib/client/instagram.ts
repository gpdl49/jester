"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstagramAccountDto, PublishingLimitDto } from "@/lib/api/types";
import { api } from "./api";
import { queryKeys } from "./queries";

export const instagramKeys = {
	all: queryKeys.instagram,
	accounts: [...queryKeys.instagram, "accounts"] as const,
	limit: (id: string) => [...queryKeys.instagram, "limit", id] as const,
};

export async function getInstagramAccounts(
	signal?: AbortSignal,
): Promise<InstagramAccountDto[]> {
	return api.get<InstagramAccountDto[]>(
		"/instagram/accounts",
		undefined,
		signal,
	);
}

export async function deleteInstagramAccount(id: string): Promise<void> {
	await api.del(`/instagram/accounts/${api.enc(id)}`);
}

export async function getPublishingLimit(
	id: string,
	signal?: AbortSignal,
): Promise<PublishingLimitDto> {
	return api.get<PublishingLimitDto>(
		`/instagram/accounts/${api.enc(id)}/limit`,
		undefined,
		signal,
	);
}

export async function setDefaultInstagramAccount(
	id: string,
): Promise<InstagramAccountDto> {
	return api.post<InstagramAccountDto>(
		`/instagram/accounts/${api.enc(id)}/default`,
	);
}

export function useInstagramAccounts(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: instagramKeys.accounts,
		queryFn: ({ signal }) => getInstagramAccounts(signal),
		enabled: options?.enabled,
	});
}

export function usePublishingLimit(id: string | null | undefined) {
	return useQuery({
		queryKey: id ? instagramKeys.limit(id) : ["instagram", "limit", "none"],
		queryFn: ({ signal }) => (id ? getPublishingLimit(id, signal) : null),
		enabled: Boolean(id),
	});
}

export function useDeleteInstagramAccount() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteInstagramAccount(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: instagramKeys.accounts });
		},
	});
}

export function useSetDefaultInstagramAccount() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => setDefaultInstagramAccount(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: instagramKeys.accounts });
		},
	});
}
