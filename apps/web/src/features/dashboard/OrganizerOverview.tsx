import { Link } from 'react-router';
import { formatMoney } from '@seatbook/shared';
import { LoadError } from '@/components/QueryStates';
import { PhaseBadge } from '@/components/PhaseBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatEventTime } from '@/lib/eventTime';
import { formatCount, formatPercent, shortDay } from '@/lib/format';
import { ChartCard, CountBars, DataTable } from './charts';
import { StatTile } from './EventDashboardPage';
import { useOrganizerOverview } from './useDashboard';

/** FR-DASH-09: the organizer's home, above "My events". */
export function OrganizerOverview() {
  const q = useOrganizerOverview();
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  const { totals, upcoming, last30Days } = q.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Tickets sold"
          value={formatCount(totals.ticketsSold)}
          note="all your events"
        />
        <StatTile label="Events on sale" value={formatCount(totals.eventsOnSale)} />
        {/* One tile per currency: BDT and USD are never added together. */}
        {totals.revenue.length === 0 ? (
          <StatTile label="Revenue" value="–" note="no sales yet" />
        ) : (
          totals.revenue.map((r) => (
            <StatTile
              key={r.currency}
              label={`Revenue (${r.currency})`}
              value={formatMoney(r.amount, r.currency)}
            />
          ))
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Tickets sold per day, last 30 days"
          table={
            <DataTable
              head={['Day', 'Tickets']}
              rows={last30Days.map((r) => [shortDay(r.day), r.tickets])}
            />
          }
        >
          <CountBars data={last30Days} x="day" y="tickets" name="tickets" formatX={shortDay} />
        </ChartCard>

        <section className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-medium">Upcoming events</h3>
          {upcoming.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing published yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/organizer/events/${e.id}/dashboard`}
                    className="block space-y-1 py-2 hover:bg-gray-50"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium wrap-anywhere">{e.title}</span>
                      <PhaseBadge phase={e.phase} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatEventTime(e.startsAt, e.timezone)}
                    </span>
                    <span className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden="true"
                        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${e.sellable ? Math.min(100, (e.sold / e.sellable) * 100) : 0}%`,
                            background: 'var(--viz-1)',
                          }}
                        />
                      </span>
                      <span className="tabular-nums">
                        {e.sold} / {e.sellable} ·{' '}
                        {e.sellable ? formatPercent(e.sold / e.sellable) : '0%'}
                      </span>
                      <span className="tabular-nums">{formatMoney(e.revenue, e.currency)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
