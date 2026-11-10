import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import type { AccountChangedPayload, BookingConfirmedPayload } from '@seatbook/shared';
import { qk } from '@/api/keys';
import { useLogout } from '@/features/auth/useAuthActions';
import { isPayingFor } from '@/features/checkout/payingNow';
import { connectSocket, disconnectSocket, getSocket } from './client';

/**
 * One connection for the logged-in user, and the account messages that apply on every page. It follows
 * the user, not the logout button: a session can also end through a 401 or another tab.
 */
export function useAccountSocket(userId: string | undefined) {
  const qc = useQueryClient();
  const { mutate: logout } = useLogout();
  const navigate = useNavigate();

  useEffect(() => {
    const s = getSocket();
    const onAccount = (p: AccountChangedPayload) => {
      if (p.suspended) {
        toast.error('Your account was suspended.');
        logout();
        return;
      }
      qc.invalidateQueries({ queryKey: qk.me }); // the nav and <Can> update at once
      if (p.application?.status === 'rejected') {
        toast.info('Your organizer application was reviewed.');
      } else if (p.application?.status === 'approved') {
        toast.success('You’re now an organizer.');
      } else {
        toast.info(`Your role is now ${p.role}.`);
      }
    };
    // A purchase made in another tab (or on another device): refresh the lists, and say so.
    const onBooking = (p: BookingConfirmedPayload) => {
      qc.invalidateQueries({ queryKey: qk.myBookings });
      qc.invalidateQueries({ queryKey: ['me', 'tickets'] });
      qc.invalidateQueries({ queryKey: qk.hold(p.eventId) }); // its countdown stops
      // The tab that paid navigates by itself, and may get this before its own HTTP answer.
      if (isPayingFor(p.eventId) || window.location.pathname === `/bookings/${p.bookingId}`) return;
      toast.success('Booking confirmed', {
        action: { label: 'View tickets', onClick: () => navigate(`/bookings/${p.bookingId}`) },
      });
    };
    s.on('account:changed', onAccount);
    s.on('booking:confirmed', onBooking);
    return () => {
      s.off('account:changed', onAccount);
      s.off('booking:confirmed', onBooking);
    };
  }, [qc, logout, navigate]);

  useEffect(() => {
    if (!userId) return;
    connectSocket();
    return disconnectSocket;
  }, [userId]);
}
