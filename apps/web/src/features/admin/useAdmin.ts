import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { OrganizerEventDto, Role } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

type ApplicationStatus = 'pending' | 'approved' | 'rejected';
type Page<T> = { items: T[]; nextCursor: string | null };

/** The shape the admin API returns: `_id`, and `userId` populated with the applicant. */
export interface ApplicationRow {
  _id: string;
  userId: { _id: string; name: string; email: string } | null;
  organizationName: string;
  website: string | null;
  message: string;
  status: ApplicationStatus;
  rejectionReason: string | null;
  createdAt: string;
}

export interface UserRow {
  _id: string;
  name: string;
  email: string;
  role: Role;
  organizationName: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface UserFilters {
  q: string;
  role: Role | 'all';
  suspended: 'all' | 'true' | 'false';
}

const withCursor = (params: URLSearchParams, cursor: string | null) => {
  if (cursor) params.set('cursor', cursor);
  return params.toString();
};

export function useApplications(status: ApplicationStatus) {
  return useInfiniteQuery({
    queryKey: qk.adminApplications(status),
    queryFn: ({ pageParam }) =>
      http.get<Page<ApplicationRow>>(
        `/admin/organizer-applications?${withCursor(new URLSearchParams({ status }), pageParam)}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useReviewApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      v: { id: string; action: 'approve' } | { id: string; action: 'reject'; reason: string },
    ) =>
      v.action === 'approve'
        ? http.post(`/admin/organizer-applications/${v.id}/approve`)
        : http.post(`/admin/organizer-applications/${v.id}/reject`, { reason: v.reason }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'applications'] }),
  });
}

export function useUsers(filters: UserFilters) {
  return useInfiniteQuery({
    queryKey: qk.adminUsers(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set('q', filters.q.trim());
      if (filters.role !== 'all') params.set('role', filters.role);
      if (filters.suspended !== 'all') params.set('suspended', filters.suspended);
      return http.get<Page<UserRow>>(`/admin/users?${withCursor(params, pageParam)}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData, // the table stays on screen while a new search loads
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: { role?: 'attendee' | 'organizer'; suspended?: boolean; reason?: string };
    }) => http.patch(`/admin/users/${v.id}`, v.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useAdminEvents() {
  return useInfiniteQuery({
    queryKey: qk.adminEvents({}),
    queryFn: ({ pageParam }) =>
      http.get<Page<OrganizerEventDto>>(
        `/admin/events?${withCursor(new URLSearchParams(), pageParam)}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
