import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from './useMe';

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return <div className="grid h-screen place-items-center text-gray-500">Loading…</div>;
  }
  if (!me.data) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return <Outlet />;
}
