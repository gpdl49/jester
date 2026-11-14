"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { MeDto } from "@/lib/api/types";
import { useMe } from "@/lib/client/queries";

/** Null until /api/me has answered. */
export const CurrentUserContext = createContext<MeDto | null>(null);

export function useCurrentUser(): MeDto | null {
	return useContext(CurrentUserContext);
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
	const me = useMe().data ?? null;
	return (
		<CurrentUserContext.Provider value={me}>
			{children}
		</CurrentUserContext.Provider>
	);
}
