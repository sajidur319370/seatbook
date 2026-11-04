import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApplications } from './useAdmin';

/** Placeholder cards until the platform dashboard (Day 19). */
export function AdminOverviewPage() {
  const pending = useApplications('pending');
  const first = pending.data?.pages[0];
  const count = first ? `${first.items.length}${first.nextCursor ? '+' : ''}` : '…';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link to="/admin/applications">
          <Card className="h-full hover:border-gray-400">
            <CardHeader>
              <CardTitle>Applications</CardTitle>
            </CardHeader>
            <CardContent>{count} pending</CardContent>
          </Card>
        </Link>
        <Link to="/admin/users">
          <Card className="h-full hover:border-gray-400">
            <CardHeader>
              <CardTitle>Users</CardTitle>
            </CardHeader>
            <CardContent>Search, change roles, suspend</CardContent>
          </Card>
        </Link>
        <Link to="/admin/events">
          <Card className="h-full hover:border-gray-400">
            <CardHeader>
              <CardTitle>Events</CardTitle>
            </CardHeader>
            <CardContent>Every event on the platform</CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
