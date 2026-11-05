import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PublicEventDto, SeatMapResponse } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useMe } from '@/features/auth/useMe';
import { timed } from '@/lib/serverClock';

export interface EventFilters {
  q?: string;
  category?: string;
  city?: string;
  from?: string;
}

export function usePublicEvents(filters: EventFilters) {
  return useInfiniteQuery({
    queryKey: ['events', filters],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][],
      );
      if (pageParam) p.set('cursor', pageParam);
      return http.get<{ items: PublicEventDto[]; nextCursor: string | null }>(`/events?${p}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
    placeholderData: keepPreviousData, // the cards stay on screen while a new search loads
  });
}

/**
 * Waits for the session check. After a reload there's no access token until the refresh finishes,
 * and a draft's owner would get a 404 if this went first. The viewer is in the key, so if a session
 * dies the page refetches as a guest instead of staying on a 401.
 */
export function useEvent(slug: string) {
  const me = useMe();
  return useQuery({
    queryKey: ['event', slug, me.data?.user.id ?? 'guest'],
    queryFn: () => http.get<{ event: PublicEventDto }>(`/events/${slug}`),
    enabled: !me.isPending,
  });
}

export const useSeatMap = (eventId: string | undefined) =>
  useQuery({
    queryKey: qk.seatMap(eventId!),
    queryFn: () => timed(() => http.get<SeatMapResponse>(`/events/${eventId}/seats`)),
    enabled: !!eventId,
    staleTime: 30_000, // Day 15: sockets keep it fresh instead
  });
