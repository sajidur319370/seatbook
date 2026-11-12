/**
 * TR-10 · database.md §14: a CORRECTNESS test under concurrency, with latency as a bonus.
 * 100 virtual buyers, each with a REST token AND a socket, click seats they THINK are free for
 * 2 minutes. Their picture of the map comes from the socket, so they act on stale data exactly as
 * people do: that's what makes it a race test. Then run `npm run check:invariants`.
 *
 *   RATE_LIMITS=off npm run dev -w @seatbook/api     (another terminal; never the live site)
 *   npm run load:holds -- --buyers 100 --seconds 120
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import type { SeatMapResponse, SeatsChangedPayload } from '@seatbook/shared';

const { values: a } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:4000' },
    event: { type: 'string', default: 'hamlet' }, // a search word for a seeded, on-sale event
    buyers: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '120' },
  },
});
const BASE = a.base!;
if (!/localhost|127\.0\.0\.1/.test(BASE))
  throw new Error('Load tests run against a LOCAL server only');
const deadline = Date.now() + Number(a.seconds) * 1000;
const lat: Record<string, number[]> = { hold: [], checkout: [], release: [] };
const count: Record<string, number> = {};
const bump = (k: string) => {
  count[k] = (count[k] ?? 0) + 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(
  kind: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
  });
  lat[kind]?.push(performance.now() - t0);
  bump(`${kind} ${res.status}`);
  if (res.status >= 500) console.error(kind, res.status, await res.text());
  return res;
}

async function login(i: number): Promise<string> {
  const creds = { email: `load${i}@load.test`, password: 'Loadtest123', name: `Load ${i}` };
  const post = (p: string) =>
    fetch(`${BASE}/api/auth/${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(creds),
    });
  let res = await post('register');
  if (res.status === 409) res = await post('login');
  if (!res.ok) throw new Error(`login ${i}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function buyer(i: number, eventId: string) {
  const token = await login(i);
  const map = (await (
    await fetch(`${BASE}/api/events/${eventId}/seats`)
  ).json()) as SeatMapResponse;
  const view = new Map(map.seats.map((s) => [s.id, { st: s.st as string, v: s.v }]));
  const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
  socket.on('connect', () => socket.emit('event:join', { eventId }, () => {}));
  socket.on('seats:changed', (p: SeatsChangedPayload) => {
    bump('socket messages');
    for (const c of p.changes) {
      const cur = view.get(c.seatId);
      if (!cur || c.version > cur.v) view.set(c.seatId, { st: c.status, v: c.version }); // version rule
    }
  });

  while (Date.now() < deadline) {
    const want = 1 + Math.floor(Math.random() * 4);
    let got = 0;
    while (got < want && Date.now() < deadline) {
      const free = [...view].filter(([, s]) => s.st === 'available').map(([id]) => id);
      if (!free.length) break;
      const seatId = free[Math.floor(Math.random() * free.length)]!;
      const r = await call('hold', 'POST', `/api/events/${eventId}/hold/seats`, token, { seatId });
      if (r.status === 200) got++;
      await sleep(100 + Math.random() * 400); // a human-ish pause between clicks
    }
    if (!got) break;
    const roll = Math.random();
    if (roll < 0.55) {
      const r = await call(
        'checkout',
        'POST',
        `/api/events/${eventId}/hold/checkout`,
        token,
        { paymentToken: 'tok_visa' },
        { 'idempotency-key': randomUUID() },
      );
      if (r.status === 201) bump('bookings');
    } else if (roll < 0.8) {
      await call('release', 'DELETE', `/api/events/${eventId}/hold`, token);
    } else {
      bump('abandoned'); // walks away: the sweeper's job now
      break;
    }
  }
  socket.close();
}

const p95 = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * 0.95)] ?? 0;
const list = (await (
  await fetch(`${BASE}/api/events?q=${encodeURIComponent(a.event!)}`)
).json()) as { items: { id: string; title: string }[] };
if (!list.items.length) throw new Error(`No public event matches "${a.event}". Seed first.`);
const eventId = list.items[0]!.id;
console.log(`${a.buyers} buyers on "${list.items[0]!.title}" for ${a.seconds} s…`);

await Promise.all(Array.from({ length: Number(a.buyers) }, (_, i) => buyer(i, eventId)));
console.table(count);
console.table(
  Object.fromEntries(
    Object.entries(lat).map(([k, xs]) => [k, { n: xs.length, p95ms: Math.round(p95(xs)) }]),
  ),
);
process.exit(Object.keys(count).some((k) => / 5\d\d$/.test(k)) ? 1 : 0); // any 5xx fails the run
