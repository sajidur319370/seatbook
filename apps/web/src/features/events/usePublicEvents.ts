import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { PublicEventDto, SeatMapResponse } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useMe } from '@/features/auth/useMe';
import { timed } from '@/lib/serverClock';
import { keepNewerSeats } from '@/socket/seatCache';

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

export function useSeatMap(eventId: string | undefined) {
  const qc = useQueryClient();
  const loggedIn = !!useMe().data?.user;
  return useQuery({
    queryKey: qk.seatMap(eventId!),
    queryFn: async ({ signal }) => {
      // `signal`: joining the room restarts this fetch, and a phone shouldn't download the map twice.
      const fresh = await timed(() =>
        http.get<SeatMapResponse>(`/events/${eventId}/seats`, { signal }),
      );
      return keepNewerSeats(fresh, qc.getQueryData<SeatMapResponse>(qk.seatMap(eventId!)));
    },
    enabled: !!eventId,
    // Logged in, the socket keeps it fresh and every join fetches it again. Guests have no socket.
    staleTime: loggedIn ? Infinity : 30_000,
  });
}
