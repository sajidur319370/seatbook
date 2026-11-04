import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizerEventDto } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

type EventResponse = { event: OrganizerEventDto };

export function useMyEvents() {
  return useInfiniteQuery({
    queryKey: qk.myEvents(),
    queryFn: ({ pageParam }) =>
      http.get<{ items: OrganizerEventDto[]; nextCursor: string | null }>(
        `/organizer/events${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useOrganizerEvent(id: string) {
  return useQuery({
    queryKey: qk.organizerEvent(id),
    queryFn: () => http.get<EventResponse>(`/organizer/events/${id}`).then((r) => r.event),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: object) =>
      http.post<EventResponse>('/organizer/events', input).then((r) => r.event),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizer', 'events'] }),
  });
}

export function useUpdateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: object) =>
      http.patch<EventResponse>(`/organizer/events/${id}`, input).then((r) => r.event),
    onSuccess: (event) => {
      qc.setQueryData(qk.organizerEvent(id), event);
      return qc.invalidateQueries({ queryKey: ['organizer', 'events'] });
    },
  });
}
