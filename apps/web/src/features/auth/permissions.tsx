import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { can, type Permission } from '@seatbook/shared';
import { ForbiddenPage } from '@/components/ForbiddenPage';
import { useMe } from './useMe';

export function useCan(permission: Permission): boolean {
  const me = useMe();
  return can(me.data?.user.role, permission);
}

export function Can(props: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  return useCan(props.permission) ? <>{props.children}</> : <>{props.fallback ?? null}</>;
}

/** Route guard: put it INSIDE <RequireAuth /> so "logged out" and "not allowed" are handled separately. */
export function RequirePermission({ perm }: { perm: Permission }) {
  return useCan(perm) ? <Outlet /> : <ForbiddenPage />;
}
