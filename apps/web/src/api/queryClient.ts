import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
import { qk } from './keys';

// A 401 that survives the refresh attempt means "logged out": clear `me`, and RequireAuth redirects.
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(qk.me, null);
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
