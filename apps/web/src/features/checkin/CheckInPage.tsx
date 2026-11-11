import { useCallback, useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  SCAN_RESULTS,
  type CheckInCounts,
  type CheckInResponse,
  type ScanFeedResponse,
  type ScanResult,
} from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { LoadError, LoadingRows, LoadMore } from '@/components/QueryStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganizerEvent } from '@/features/organizer/useOrganizerEvents';
import { formatEventTime, formatTimeOfDay } from '@/lib/eventTime';
import { feedback } from './feedback';
import { QrScanner } from './QrScanner';
import { describeResult, mergeCounts, type Tone } from './results';
import { useStaffRoom } from './useStaffRoom';

const GATE_KEY = 'seatbook.gate';
const readGate = () => {
  try {
    return localStorage.getItem(GATE_KEY) ?? '';
  } catch {
    return ''; // private mode: fine, no remembered gate
  }
};
const saveGate = (g: string) => {
  try {
    localStorage.setItem(GATE_KEY, g);
  } catch {
    /* not remembered, still used */
  }
};

const TONE_STYLE: Record<Tone, string> = {
  ok: 'border-green-300 bg-green-50 text-green-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  bad: 'border-red-300 bg-red-50 text-red-900',
};

function ToneIcon({ result, tone }: { result: ScanResult; tone: Tone }) {
  const cls = 'size-10 shrink-0';
  if (tone === 'ok') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (result === 'outside_window') return <Clock className={cls} aria-hidden="true" />;
  if (tone === 'warn') return <AlertTriangle className={cls} aria-hidden="true" />;
  return <XCircle className={cls} aria-hidden="true" />;
}

/** Full width, icon AND words (never colour alone), read out by screen readers (NFR-A11Y-04). */
function ResultCard(props: { r: CheckInResponse; timezone: string; onDismiss: () => void }) {
  const { r, onDismiss } = props;
  const d = describeResult(r, props.timezone);
  useEffect(() => {
    const t = setTimeout(onDismiss, 4_000);
    return () => clearTimeout(t);
  }, [r, onDismiss]);
  return (
    <button
      type="button"
      role="status"
      onClick={onDismiss}
      data-testid="scan-result"
      data-result={r.result}
      className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left ${TONE_STYLE[d.tone]}`}
    >
      <ToneIcon result={r.result} tone={d.tone} />
      <span className="min-w-0">
        <span className="block text-2xl font-bold">{d.title}</span>
        {d.detail && <span className="block text-sm wrap-anywhere">{d.detail}</span>}
      </span>
    </button>
  );
}

function ManualEntry({ disabled, onSubmit }: { disabled: boolean; onSubmit: (c: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim()) return;
        onSubmit(code.trim());
        setCode('');
      }}
    >
      <Input
        aria-label="Manual code"
        placeholder="Type the code: 7KQ2-9XF3-AB"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="font-mono"
      />
      <Button type="submit" disabled={disabled || !code.trim()}>
        Check
      </Button>
    </form>
  );
}

type Recent = CheckInResponse & { key: number; at: string };

function ScanTab(props: {
  eventId: string;
  timezone: string;
  initialCounts: CheckInCounts;
  active: boolean; // hidden behind the log tab: keep the state, stop the camera
}) {
  const { eventId, timezone } = props;
  const [gate, setGate] = useState(readGate);
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [counts, setCounts] = useState<CheckInCounts | null>(props.initialCounts);
  const [cameraError, setCameraError] = useState<string | null>(null);
  useStaffRoom(eventId, (p) => setCounts((c) => mergeCounts(c, p.counts))); // other gates
  const dismiss = useCallback(() => setResult(null), []);

  const scan = useMutation({
    mutationFn: (v: { code: string; method: 'qr' | 'manual' }) =>
      http.post<CheckInResponse>(`/organizer/events/${eventId}/check-in`, {
        ...v,
        gate: gate.trim() || null,
      }),
    onSuccess: (r) => {
      setResult(r);
      setCounts((c) => mergeCounts(c, r.counts));
      setRecent((xs) =>
        [{ ...r, key: Date.now(), at: new Date().toISOString() }, ...xs].slice(0, 20),
      );
      feedback(r.result);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm">
        <p className="text-sm text-gray-600">
          <span
            className="block text-2xl font-bold text-gray-900 tabular-nums"
            data-testid="checked-in"
          >
            {counts ? `${counts.checkedIn} / ${counts.sold}` : '–'}
          </span>
          checked in
        </p>
        <label className="text-sm">
          <span className="block text-gray-600">Gate (optional)</span>
          <Input
            value={gate}
            maxLength={30}
            placeholder="Gate 1"
            className="w-32"
            onChange={(e) => {
              setGate(e.target.value);
              saveGate(e.target.value);
            }}
          />
        </label>
      </div>

      {cameraError ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          The camera isn’t available ({cameraError}). It needs HTTPS and your permission. Type the
          code below instead.
        </p>
      ) : (
        <QrScanner
          paused={scan.isPending || !props.active}
          onCode={(code) => scan.mutate({ code, method: 'qr' })}
          onError={setCameraError}
        />
      )}

      <ManualEntry
        disabled={scan.isPending}
        onSubmit={(code) => scan.mutate({ code, method: 'manual' })}
      />

      {scan.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {scan.error instanceof ApiError ? scan.error.message : 'No connection. Scan again.'}
        </p>
      )}
      {result && <ResultCard r={result} timezone={timezone} onDismiss={dismiss} />}

      {recent.length > 0 && (
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold">Recent scans</h2>
          <ul className="divide-y text-sm">
            {recent.map((r) => {
              const d = describeResult(r, timezone);
              return (
                <li key={r.key} className="flex justify-between gap-2 py-1.5">
                  <span
                    className={
                      d.tone === 'ok'
                        ? 'text-green-800'
                        : d.tone === 'warn'
                          ? 'text-amber-800'
                          : 'text-red-800'
                    }
                  >
                    {d.title}
                    {r.ticket && <span className="text-gray-600"> · {r.ticket.seatLabel}</span>}
                  </span>
                  <span className="text-gray-500 tabular-nums">
                    {formatTimeOfDay(r.at, timezone)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** FR-CHK-12 (Should): every attempt, newest first, filter by result. */
function ScanLogTab({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [filter, setFilter] = useState<ScanResult | ''>('');
  const q = useInfiniteQuery({
    queryKey: ['organizer', 'scans', eventId, filter],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (filter) p.set('result', filter);
      if (pageParam) p.set('cursor', pageParam);
      return http.get<ScanFeedResponse>(`/organizer/events/${eventId}/scans?${p}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 0,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        Show
        <select
          className="rounded-md border bg-white px-2 py-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ScanResult | '')}
        >
          <option value="">All results</option>
          {SCAN_RESULTS.map((r) => (
            <option key={r} value={r}>
              {describeResult({ result: r, ticket: null }, timezone).title}
            </option>
          ))}
        </select>
      </label>
      {q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">No scans yet.</p>
      ) : (
        <ul className="divide-y rounded-xl bg-white text-sm shadow-sm">
          {rows.map((s) => (
            <li key={s.id} className="flex justify-between gap-2 px-3 py-2">
              <span>
                <b>{describeResult({ result: s.result, ticket: null }, timezone).title}</b>
                {s.seatLabel && (
                  <span className="text-gray-600">
                    {' '}
                    · {s.seatLabel} · {s.holderName}
                  </span>
                )}
                <span className="block text-xs text-gray-500">
                  {s.method === 'qr' ? 'Camera' : 'Typed'}
                  {s.gate && ` · ${s.gate}`}
                </span>
              </span>
              <span className="text-gray-500 tabular-nums">
                {formatTimeOfDay(s.createdAt, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasMore={q.hasNextPage}
        loading={q.isFetchingNextPage}
        onClick={() => q.fetchNextPage()}
      />
    </div>
  );
}

/** FR-CHK-09: built for a phone in one hand at the door. */
export function CheckInPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const ev = useOrganizerEvent(eventId);
  const [tab, setTab] = useState('scan');

  if (ev.isError) {
    if (ev.error instanceof ApiError && ev.error.status === 404) {
      return (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-semibold">Event not found</h1>
          <Link to="/organizer" className="text-blue-600 hover:underline">
            Back to my events
          </Link>
        </div>
      );
    }
    return <LoadError error={ev.error} onRetry={() => ev.refetch()} />;
  }
  if (!ev.data) return <LoadingRows />;
  const event = ev.data;
  const initialCounts = {
    checkedIn: event.counters.ticketsCheckedIn,
    sold: event.counters.seatsSold,
  };

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div>
        <Link to="/organizer" className="text-sm text-blue-600 hover:underline">
          ← My events
        </Link>
        <h1 className="text-xl font-semibold wrap-anywhere">Check-in · {event.title}</h1>
        <p className="text-sm text-gray-600">{formatEventTime(event.startsAt, event.timezone)}</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="scan">Scan</TabsTrigger>
          <TabsTrigger value="log">Scan log</TabsTrigger>
        </TabsList>
        {/* Mounted even when hidden, so the counter and recent scans survive a look at the log. */}
        <TabsContent value="scan" forceMount className="mt-3 data-[state=inactive]:hidden">
          <ScanTab
            eventId={event.id}
            timezone={event.timezone}
            initialCounts={initialCounts}
            active={tab === 'scan'}
          />
        </TabsContent>
        <TabsContent value="log" className="mt-3">
          <ScanLogTab eventId={event.id} timezone={event.timezone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
