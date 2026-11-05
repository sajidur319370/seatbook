import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  EVENT_CATEGORIES,
  formatMoney,
  type EventCategory,
  type PublicEventDto,
} from '@seatbook/shared';
import { EmptyState, LoadError, LoadingRows } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhaseBadge } from '@/components/PhaseBadge';
import { formatEventTime } from '@/lib/eventTime';
import { SWATCH } from '@/lib/palette';
import { useDebounced } from '@/lib/useDebounced';
import { usePublicEvents } from './usePublicEvents';

/**
 * Links can be edited by hand or come from an older version. A filter that makes no sense is ignored,
 * so nobody lands on a crash or on "Some fields are invalid".
 */
const validCategory = (value: string | null) =>
  EVENT_CATEGORIES.includes(value as EventCategory) ? (value as EventCategory) : '';

/** Midnight at the start of that day in the visitor's zone, or undefined if it isn't a real date. */
function startOfDayIso(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const d = new Date(`${date}T00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function EventCard({ e }: { e: PublicEventDto }) {
  return (
    <Link
      to={`/e/${e.slug}`}
      className="group overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md"
    >
      <div className={`flex h-28 items-end p-3 ${SWATCH[e.coverColor]}`}>
        <span className="rounded bg-white/90 px-2 py-0.5 text-xs font-medium capitalize">
          {e.category}
        </span>
      </div>
      <div className="space-y-1 p-4">
        <h3 className="line-clamp-2 font-semibold wrap-anywhere group-hover:underline">
          {e.title}
        </h3>
        <p className="text-sm text-gray-600">{formatEventTime(e.startsAt, e.timezone)}</p>
        <p className="text-sm text-gray-600">
          {e.venue.name} · {e.venue.city}
        </p>
        <div className="flex items-center justify-between pt-2">
          {e.lowestPrice !== null && (
            <span className="text-sm">
              From <b>{formatMoney(e.lowestPrice, e.currency)}</b>
            </span>
          )}
          {e.soldOut ? (
            <Badge variant="secondary">Sold out</Badge>
          ) : (
            e.phase !== 'on_sale' && <PhaseBadge phase={e.phase} />
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * A text box whose value lives in the URL, so a search can be shared. Typing stays local and the URL
 * follows after a pause. If the URL changes any other way (Back, a nav link), the box follows it.
 */
const inUrlNow = (name: string) => new URLSearchParams(window.location.search).get(name) ?? '';

function useUrlText(name: string, max: number): [string, (value: string) => void, string] {
  const [params, setParams] = useSearchParams();
  const inUrl = (params.get(name) ?? '').slice(0, max); // the API rejects anything longer
  const [text, setText] = useState(inUrl);
  const debounced = useDebounced(text);
  const [lastUrl, setLastUrl] = useState(inUrl);

  if (inUrl !== lastUrl) {
    setLastUrl(inUrl);
    if (inUrl !== debounced) setText(inUrl);
  }

  // Only a newly settled value writes to the URL. setParams changes with every URL change, so without
  // this check, Clear filters or a nav link would put the old text straight back for a moment.
  const written = useRef(debounced);
  useEffect(() => {
    if (debounced === written.current) return;
    written.current = debounced;
    if (debounced === inUrlNow(name).slice(0, max)) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set(name, debounced);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  }, [debounced, name, max, setParams]);

  return [text, setText, inUrl];
}

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch, q] = useUrlText('q', 80);
  const [cityText, setCityText, city] = useUrlText('city', 60);
  const category = validCategory(params.get('category'));
  const from = startOfDayIso(params.get('date') ?? '');
  const date = from ? (params.get('date') ?? '') : '';
  const query = usePublicEvents({
    q,
    city,
    category,
    from,
  });

  const setParam = (name: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  // Infinite scroll: load the next page when the sentinel comes near the screen.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const events = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(q || city || category || date);

  const chip = (value: string, label: string) => (
    <button
      key={value || 'all'}
      type="button"
      aria-pressed={category === value}
      onClick={() => setParam('category', value)}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm capitalize ${category === value ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Upcoming events</h1>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_11rem]">
        <Input
          aria-label="Search events"
          placeholder="Search by event, venue or city"
          maxLength={80}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Input
          aria-label="City"
          placeholder="City"
          maxLength={60}
          value={cityText}
          onChange={(e) => setCityText(e.target.value)}
        />
        <Input
          aria-label="On or after"
          type="date"
          value={date}
          onChange={(e) => setParam('date', e.target.value)}
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chip('', 'All')}
        {EVENT_CATEGORIES.map((c) => chip(c, c))}
      </div>

      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState title={filtered ? 'No upcoming events match' : 'No upcoming events yet'}>
          {filtered && (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setCityText('');
                setParams({}, { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="event-grid">
          {events.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </div>
      )}
      <div ref={sentinel} />
      {isFetchingNextPage && <LoadingRows />}
    </div>
  );
}
