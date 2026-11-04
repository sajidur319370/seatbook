import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Can } from '@/features/auth/permissions';
import { useMe } from '@/features/auth/useMe';
import { Skeleton } from '@/components/ui/skeleton';
import { UserMenu } from './UserMenu';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`;

export function AppShell() {
  const me = useMe();
  const user = me.data?.user;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 shrink-0 text-lg font-bold sm:mr-4">
            <span aria-hidden="true">🎟️</span>
            <span className="max-sm:sr-only"> SeatBook</span>
          </Link>
          {/* The nav scrolls sideways on a phone instead of pushing the page wider than the screen. */}
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <NavLink to="/" end className={navClass}>
              Events
            </NavLink>
            {user && (
              <NavLink to="/me/tickets" className={navClass}>
                My tickets
              </NavLink>
            )}
            <Can permission="event:manage">
              <NavLink to="/organizer" className={navClass}>
                Organizer
              </NavLink>
            </Can>
            <Can permission="admin:overview">
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            </Can>
          </nav>
          <div className="shrink-0">
            {user ? (
              <UserMenu user={user} />
            ) : (
              <Link to="/login" className="text-sm font-medium">
                Log in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
