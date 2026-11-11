import { Link } from 'react-router';
import { EVENT_PHASES, formatMoney } from '@seatbook/shared';
import { LoadError } from '@/components/QueryStates';
import { PhaseBadge } from '@/components/PhaseBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartCard, CountBars, DataTable } from '@/features/dashboard/charts';
import { StatTile } from '@/features/dashboard/EventDashboardPage';
import { useAdminOverview } from '@/features/dashboard/useDashboard';
import { formatCount, shortDay } from '@/lib/format';

/** FR-DASH-10: the platform at a glance. Days here are UTC (requirement §15.4). */
export function AdminOverviewPage() {
  const q = useAdminOverview();
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="space-x-3 text-sm">
          <Link to="/admin/users" className="text-blue-600 hover:underline">
            Users
          </Link>
          <Link to="/admin/events" className="text-blue-600 hover:underline">
            Events
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Attendees" value={formatCount(d.users.attendee)} />
        <StatTile label="Organizers" value={formatCount(d.users.organizer)} />
        <StatTile label="Admins" value={formatCount(d.users.admin)} />
        <StatTile
          label="Suspended"
          value={formatCount(d.users.suspended)}
          note="counted in their role too"
        />
        <Link to="/admin/applications" className="block hover:opacity-90">
          <StatTile
            label="Pending applications"
            value={formatCount(d.pendingApplications)}
            note="Review the queue →"
          />
        </Link>
      </div>

      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">Events by phase</h3>
        <ul className="mt-3 flex flex-wrap gap-3">
          {EVENT_PHASES.map((p) => (
            <li key={p} className="flex items-center gap-2 text-sm">
              <PhaseBadge phase={p} />
              <span className="font-semibold tabular-nums">{d.eventsByPhase[p]}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-medium">Sales (GMV), confirmed bookings</h3>
          {d.gmv.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No sales yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {/* Per currency: never added together. */}
              {d.gmv.map((g) => (
                <li key={g.currency}>
                  <p className="text-2xl font-semibold">{formatMoney(g.revenue, g.currency)}</p>
                  <p className="text-sm text-muted-foreground">
                    {g.currency} · {formatCount(g.bookings)} bookings
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <ChartCard
          title="Tickets sold per day, last 30 days (UTC days)"
          table={
            <DataTable
              head={['Day (UTC)', 'Tickets']}
              rows={d.ticketsPerDay.map((r) => [shortDay(r.day), r.tickets])}
            />
          }
        >
          <CountBars data={d.ticketsPerDay} x="day" y="tickets" name="tickets" formatX={shortDay} />
        </ChartCard>
      </div>
    </div>
  );
}
