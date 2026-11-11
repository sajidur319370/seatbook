import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminOverviewDto,
  AttendeeListResponse,
  EventDashboardDto,
  OrganizerOverviewDto,
} from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useStaffRoom } from '@/socket/useStaffRoom';
import { applyCheckin, applySales } from './kpi';

export type Scope = 'organizer' | 'admin';
const REFETCH_EVERY_MS = 30_000; // FR-DASH-05: charts refetch at most every 30 s

export const useEventDashboard = (eventId: string, scope: Scope) =>
  useQuery({
    queryKey: qk.dashboard(scope, eventId),
    queryFn: () => http.get<EventDashboardDto>(`/${scope}/events/${eventId}/dashboard`),
    staleTime: REFETCH_EVERY_MS,
  });

/**
 * FR-DASH-05: the tiles move at once from the staff room; the full refetch (charts, and the
 * aggregation correcting any drifted display counter) happens at most every 30 s.
 */
export function useDashboardLive(eventId: string, scope: Scope) {
  const qc = useQueryClient();
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const key = qk.dashboard(scope, eventId);
  const refetchSoon = () => {
    if (timer.current) return; // one refetch is already scheduled
    const last = qc.getQueryState(key)?.dataUpdatedAt ?? 0;
    timer.current = window.setTimeout(
      () => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: key });
      },
      Math.max(0, last + REFETCH_EVERY_MS - Date.now()),
    );
  };
  const patch = (fn: (k: EventDashboardDto['kpi']) => EventDashboardDto['kpi']) =>
    qc.setQueryData<EventDashboardDto>(key, (d) => d && { ...d, kpi: fn(d.kpi) });

  useStaffRoom(eventId, {
    onSales: (p) => {
      patch((k) => applySales(k, p));
      refetchSoon();
    },
    onCheckin: (p) => {
      patch((k) => applyCheckin(k, p));
      refetchSoon();
    },
    onReconnect: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export const useAttendees = (eventId: string, q: string) =>
  useInfiniteQuery({
    queryKey: qk.attendees(eventId, q),
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (pageParam) p.set('cursor', pageParam);
      return http.get<AttendeeListResponse>(`/organizer/events/${eventId}/attendees?${p}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

export const useOrganizerOverview = () =>
  useQuery({
    queryKey: qk.organizerOverview,
    queryFn: () => http.get<OrganizerOverviewDto>('/organizer/overview'),
  });

export const useAdminOverview = () =>
  useQuery({
    queryKey: qk.adminOverview,
    queryFn: () => http.get<AdminOverviewDto>('/admin/overview'),
  });
