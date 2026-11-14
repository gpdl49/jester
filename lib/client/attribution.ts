"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AnalysisDto, MemeDetailDto } from "@/lib/api/types";
import { api } from "./api";
import { queryKeys } from "./queries";

export const attributionApi = {
	requestAttribution: (memeId: string) =>
		api.post<AnalysisDto>(`/memes/${api.enc(memeId)}/analyses`, {
			kind: "attribution",
		}),

	confirmAttribution: (memeId: string, candidateId: string) =>
		api.post<MemeDetailDto>(
			`/memes/${api.enc(memeId)}/attribution/${api.enc(candidateId)}/confirm`,
		),

	rejectAttribution: (memeId: string, candidateId: string) =>
		api.post<MemeDetailDto>(
			`/memes/${api.enc(memeId)}/attribution/${api.enc(candidateId)}/reject`,
		),

	updateCreditText: (memeId: string, creditText: string) =>
		api.patch<MemeDetailDto>(`/memes/${api.enc(memeId)}`, {
			creditText,
		}),
};

export function useRequestAttribution() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (memeId: string) => attributionApi.requestAttribution(memeId),
		onSuccess: (_data, memeId) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.meme(memeId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
		},
	});
}

export function useConfirmAttribution() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			memeId,
			candidateId,
		}: {
			memeId: string;
			candidateId: string;
		}) => attributionApi.confirmAttribution(memeId, candidateId),
		onSuccess: (data) => {
			queryClient.setQueryData(queryKeys.meme(data.id), data);
			queryClient.invalidateQueries({ queryKey: queryKeys.meme(data.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
		},
	});
}

export function useRejectAttribution() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			memeId,
			candidateId,
		}: {
			memeId: string;
			candidateId: string;
		}) => attributionApi.rejectAttribution(memeId, candidateId),
		onSuccess: (data) => {
			queryClient.setQueryData(queryKeys.meme(data.id), data);
			queryClient.invalidateQueries({ queryKey: queryKeys.meme(data.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
		},
	});
}

export function useUpdateCreditText() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			memeId,
			creditText,
		}: {
			memeId: string;
			creditText: string;
		}) => attributionApi.updateCreditText(memeId, creditText),
		onSuccess: (data) => {
			queryClient.setQueryData(queryKeys.meme(data.id), data);
			queryClient.invalidateQueries({ queryKey: queryKeys.meme(data.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.memes });
		},
	});
}
