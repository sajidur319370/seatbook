import { useQuery } from '@tanstack/react-query';
import type { BookingDto, MyTicketsResponse, TicketResponse } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

export const useMyBooking = (id: string) =>
  useQuery({
    queryKey: qk.myBooking(id),
    queryFn: () => http.get<{ booking: BookingDto }>(`/me/bookings/${id}`),
    enabled: !!id,
  });

export const useMyTickets = (when: 'upcoming' | 'past') =>
  useQuery({
    queryKey: qk.myTickets(when),
    queryFn: () => http.get<MyTicketsResponse>(`/me/tickets?when=${when}`),
  });

/**
 * Always fresh, and again when the phone comes back to this tab: after a scan at the door, the
 * attendee should see "Checked in at 19:42" (Day 18). The server sends it with no-store.
 */
export const useMyTicket = (id: string) =>
  useQuery({
    queryKey: qk.myTicket(id),
    queryFn: () => http.get<TicketResponse>(`/me/tickets/${id}`),
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
