import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { AuthResponse, LoginInput, MeResponse, RegisterInput } from '@seatbook/shared';
import { http, setAccessToken } from '@/api/client';
import { qk } from '@/api/keys';

/**
 * Only allow paths on this site, to prevent open redirects. Parsing with URL is what catches the
 * tricks a prefix check misses: browsers read "/\evil.com" and "/<tab>/evil.com" as "//evil.com".
 */
export function safeReturnTo(v: string | null): string {
  if (!v?.startsWith('/')) return '/';
  try {
    const url = new URL(v, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

export function useLogin(returnTo: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (v: LoginInput) => http.post<AuthResponse>('/auth/login', v),
    onSuccess: async ({ accessToken }) => {
      setAccessToken(accessToken);
      qc.clear(); // a session that expired left its data cached: don't show it to the next account
      qc.setQueryData(qk.me, await http.get<MeResponse>('/me'));
      navigate(returnTo, { replace: true });
    },
  });
}

export function useRegister(returnTo: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (v: RegisterInput) => http.post<AuthResponse>('/auth/register', v),
    onSuccess: async ({ accessToken }) => {
      setAccessToken(accessToken);
      qc.clear(); // a session that expired left its data cached: don't show it to the next account
      qc.setQueryData(qk.me, await http.get<MeResponse>('/me'));
      navigate(returnTo, { replace: true });
    },
  });
}

export function useLogout(all = false) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => http.post<void>(all ? '/auth/logout-all' : '/auth/logout'),
    onError: () => {
      // The httpOnly cookie can only be removed by the server, so this browser may still be logged in.
      toast.error("Couldn't reach the server, so your session may still be active.");
    },
    onSettled: () => {
      setAccessToken(null);
      qc.clear(); // drop every cached query of the previous user
      qc.setQueryData(qk.me, null);
      navigate('/login', { replace: true });
    },
  });
}
