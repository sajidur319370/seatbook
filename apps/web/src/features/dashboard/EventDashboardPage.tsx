import { Link, useParams } from 'react-router';
import { formatMoney, type Currency, type DayRow, type EventDashboardDto } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { PhaseBadge } from '@/components/PhaseBadge';
import { LoadError } from '@/components/QueryStates';
import { Skeleton } from '@/components/ui/skeleton';
import { TIER_HEX } from '@/components/seatmap/tierColors';
import { formatEventTime, formatTimeOfDay } from '@/lib/eventTime';
import { formatCount, formatMoneyCompact, formatPercent, shortDay } from '@/lib/format';
import { ChartCard, CountBars, DataTable, RunningLine } from './charts';
import { fillBuckets } from './kpi';
import { useDashboardLive, useEventDashboard, type Scope } from './useDashboard';

/** A stat tile, not a chart: one number with one line of context (FR-DASH-01). */
export function StatTile(props: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{props.label}</p>
      {/* wrap-anywhere: "BDT 1,250,000.00" must wrap inside its tile, never widen the page. */}
      <p className="mt-1 text-2xl font-semibold wrap-anywhere" data-testid={props.testId}>
        {props.value}
      </p>
      {props.note && <p className="mt-1 text-sm text-muted-foreground">{props.note}</p>}
    </div>
  );
}

function KpiTiles({ kpi, currency }: { kpi: EventDashboardDto['kpi']; currency: Currency }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <StatTile
        label="Tickets sold"
        value={formatCount(kpi.sold)}
        note={`of ${formatCount(kpi.sellable)} · ${formatPercent(kpi.soldPct)}`}
        testId="kpi-sold"
      />
      <StatTile
        label="Revenue"
        value={formatMoney(kpi.revenue, currency)}
        note={`avg ${formatMoney(kpi.avgTicketPrice, currency)} a ticket`}
        testId="kpi-revenue"
      />
      <StatTile
        label="Checked in"
        value={formatCount(kpi.checkedIn)}
        note={`${formatPercent(kpi.checkinRate)} of sold`}
        testId="kpi-checked-in"
      />
      <StatTile label="Held right now" value={formatCount(kpi.heldNow)} note="in buyers’ carts" />
      <StatTile
        label="Duplicate scans"
        value={formatCount(kpi.duplicateScans)}
        note="same ticket scanned twice"
        testId="kpi-duplicates"
      />
    </div>
  );
}

function SalesCharts({ rows, currency }: { rows: DayRow[]; currency: Currency }) {
  const money = (minor: number) => formatMoney(minor, currency);
  const table = (
    <DataTable
      head={['Day', 'Tickets', 'Revenue', 'Revenue to date']}
      rows={rows.map((r) => [shortDay(r.day), r.tickets, money(r.revenue), money(r.cumRevenue)])}
    />
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Two measures, two charts: never one chart with two y-axes. */}
      <ChartCard title="Tickets sold per day" table={table}>
        <CountBars data={rows} x="day" y="tickets" name="tickets" formatX={shortDay} />
      </ChartCard>
      <ChartCard title="Revenue to date" table={table}>
        <RunningLine
          data={rows}
          x="day"
          y="cumRevenue"
          name="to date"
          formatX={shortDay}
          formatY={money}
          formatTick={(v) => formatMoneyCompact(v, currency)}
        />
      </ChartCard>
    </div>
  );
}

/** FR-DASH-03 as a table: a handful of rows of exact numbers reads better than a chart. */
function TierTable({ tiers, currency }: { tiers: EventDashboardDto['tiers']; currency: Currency }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">Sales by tier</h3>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Tier</th>
            <th className="py-1 font-medium">Sold</th>
            <th className="hidden py-1 font-medium sm:table-cell">
              <span className="sr-only">Share sold</span>
            </th>
            <th className="py-1 text-right font-medium">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tierId} className="border-t">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-sm"
                    style={{ background: TIER_HEX[t.color] }}
                  />
                  {t.name}
                  {t.sellable > 0 && t.sold >= t.sellable && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Sold out</span>
                  )}
                </span>
              </td>
              <td className="py-2 tabular-nums">
                {t.sold} / {t.sellable}
              </td>
              <td className="hidden w-1/3 py-2 sm:table-cell">
                {/* The numbers beside it carry the meaning; the bar is a glance. */}
                <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${t.sellable ? Math.min(100, (t.sold / t.sellable) * 100) : 0}%`,
                      background: TIER_HEX[t.color],
                    }}
                  />
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">{formatMoney(t.revenue, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** FR-DASH-04: 5-minute buckets in the event's zone; the API sends only non-empty ones. */
function CheckinsChart({ rows, tz }: { rows: EventDashboardDto['checkinsOverTime']; tz: string }) {
  if (!rows.length) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">Check-ins every 5 minutes</h3>
        <p className="py-10 text-center text-sm text-muted-foreground">
          Check-ins will appear here on event day.
        </p>
      </section>
    );
  }
  const filled = fillBuckets(rows);
  const time = (at: string) => formatTimeOfDay(at, tz);
  return (
    <ChartCard
      title="Check-ins every 5 minutes"
      table={<DataTable head={['From', 'Check-ins']} rows={filled.map((r) => [time(r.at), r.n])} />}
    >
      <CountBars data={filled} x="at" y="n" name="check-ins" formatX={time} />
    </ChartCard>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading">
      <Skeleton className="h-10 w-1/2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function EventDashboardPage({ scope }: { scope: Scope }) {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const q = useEventDashboard(eventId, scope);
  useDashboardLive(eventId, scope);

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-semibold">Event not found</h1>
          <Link
            to={scope === 'admin' ? '/admin/events' : '/organizer'}
            className="text-blue-600 hover:underline"
          >
            Back
          </Link>
        </div>
      );
    }
    return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <DashboardSkeleton />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={scope === 'admin' ? '/admin/events' : '/organizer'}
          className="text-sm text-blue-600 hover:underline"
        >
          ← {scope === 'admin' ? 'All events' : 'My events'}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold wrap-anywhere">{d.event.title}</h1>
          <PhaseBadge phase={d.event.phase} />
        </div>
        <p className="text-sm text-muted-foreground">
          {formatEventTime(d.event.startsAt, d.event.timezone)} · Days are in {d.event.timezone} ·
          Updated {formatTimeOfDay(d.generatedAt, d.event.timezone)}
        </p>
        {scope === 'organizer' && (
          <p className="mt-1 space-x-3 text-sm">
            <Link
              to={`/organizer/events/${eventId}/attendees`}
              className="text-blue-600 hover:underline"
            >
              Attendees
            </Link>
            <Link
              to={`/organizer/events/${eventId}/check-in`}
              className="text-blue-600 hover:underline"
            >
              Check-in
            </Link>
          </p>
        )}
      </div>
      <KpiTiles kpi={d.kpi} currency={d.event.currency} />
      <SalesCharts rows={d.salesPerDay} currency={d.event.currency} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TierTable tiers={d.tiers} currency={d.event.currency} />
        <CheckinsChart rows={d.checkinsOverTime} tz={d.event.timezone} />
      </div>
    </div>
  );
}
