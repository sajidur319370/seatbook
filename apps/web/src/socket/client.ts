import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@seatbook/shared';
import { getAccessToken, refreshAccessToken } from '@/api/client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

const RETRY_MS = 5_000;
const PATIENCE_MS = 8_000;

let socket: AppSocket | null = null;
let wanted = false; // logged in, so we should be connected
let authRetries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let patienceTimer: ReturnType<typeof setTimeout> | undefined;

let state: ConnectionState = 'idle';
const listeners = new Set<() => void>();
const setState = (next: ConnectionState) => {
  state = next;
  listeners.forEach((l) => l());
};
export const getConnectionState = () => state;
export const subscribeToConnection = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function getSocket(): AppSocket {
  if (socket) return socket;
  const s: AppSocket = io({
    autoConnect: false,
    // WebSocket first. If a proxy or firewall blocks it, long polling still delivers every message.
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    auth: (cb) => cb({ token: getAccessToken() }), // a function: a fresh token on every (re)connect
  });
  socket = s;

  s.on('connect', () => {
    authRetries = 0;
    setState('online');
  });
  s.on('disconnect', () => setState(wanted ? 'offline' : 'idle'));
  s.on('connect_error', async (err) => {
    if (wanted) setState('offline');
    if (!wanted || s.active) return; // a network problem: Socket.IO keeps retrying by itself
    if (err.message === 'ACCOUNT_SUSPENDED') return; // account:changed or the API's 403 handles it
    if (err.message === 'UNAUTHENTICATED' || err.message === 'TOKEN_EXPIRED') {
      if (authRetries++ < 2 && (await refreshAccessToken()) && wanted) s.connect();
      return;
    }
    // The server refused for its own reasons, like a database blip. It won't retry unless asked.
    retryTimer = setTimeout(() => {
      if (wanted) s.connect();
    }, RETRY_MS);
  });
  return s;
}

export function connectSocket() {
  wanted = true;
  authRetries = 0;
  const s = getSocket();
  if (s.connected) return;
  setState('connecting');
  // A connection can hang, or drop before it's finished, with no event at all. The map is out of date either way.
  clearTimeout(patienceTimer);
  patienceTimer = setTimeout(() => {
    if (state === 'connecting') setState('offline');
  }, PATIENCE_MS);
  s.connect();
}

export function disconnectSocket() {
  wanted = false;
  clearTimeout(retryTimer);
  clearTimeout(patienceTimer);
  socket?.disconnect();
  setState('idle');
}
