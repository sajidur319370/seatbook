import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AccountChangedPayload } from '@seatbook/shared';
import { qk } from '@/api/keys';
import { useLogout } from '@/features/auth/useAuthActions';
import { connectSocket, disconnectSocket, getSocket } from './client';

/**
 * One connection for the logged-in user, and the account messages that apply on every page. It follows
 * the user, not the logout button: a session can also end through a 401 or another tab.
 */
export function useAccountSocket(userId: string | undefined) {
  const qc = useQueryClient();
  const { mutate: logout } = useLogout();

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
    s.on('account:changed', onAccount);
    return () => {
      s.off('account:changed', onAccount);
    };
  }, [qc, logout]);

  useEffect(() => {
    if (!userId) return;
    connectSocket();
    return disconnectSocket;
  }, [userId]);
}
