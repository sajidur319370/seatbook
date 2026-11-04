import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function LoadingRows() {
  return (
    <div className="space-y-2" aria-label="Loading">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{error instanceof ApiError ? error.message : "We couldn't reach the server."}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-white p-8 text-center">
      <p className="font-medium">{props.title}</p>
      {props.children && <div className="mt-3">{props.children}</div>}
    </div>
  );
}

export function LoadMore(props: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!props.hasMore) return null;
  return (
    <div className="mt-4 text-center">
      <Button variant="outline" disabled={props.loading} onClick={props.onClick}>
        {props.loading ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}
