import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, setAccessToken } from './client';
import { qk } from './keys';

const onError = (err: unknown) => {
  if (!(err instanceof ApiError)) return;
  if (err.code === 'ACCOUNT_SUSPENDED') {
    // Requirement §23.3. Only toast for someone who was using the app: the login form shows its own error.
    if (queryClient.getQueryData(qk.me)) toast.error('This account is suspended.');
    setAccessToken(null);
    queryClient.setQueryData(qk.me, null); // RequireAuth redirects to login
  } else if (err.status === 401) {
    // A 401 that survives the refresh attempt means "logged out".
    queryClient.setQueryData(qk.me, null);
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});
