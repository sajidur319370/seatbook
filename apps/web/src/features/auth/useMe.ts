import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@seatbook/shared';
import { getAccessToken, http, refreshAccessToken } from '@/api/client';
import { qk } from '@/api/keys';

/** null = logged out. On first load there's no access token in memory, so try the cookie. */
export async function loadMe(): Promise<MeResponse | null> {
  if (!getAccessToken() && !(await refreshAccessToken())) return null;
  return http.get<MeResponse>('/me');
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: loadMe, staleTime: 5 * 60_000 });
}
