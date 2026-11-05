import { useEffect, useReducer } from 'react';
import { msUntil } from '@/lib/serverClock';

/**
 * Milliseconds left, worked out afresh on every render, never by counting down: browsers slow timers
 * in hidden tabs, so a counter would drift. The timer only asks for a new render.
 */
export function useCountdown(expiresAt: string) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick); // tab comes back → correct immediately
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return Math.max(0, msUntil(expiresAt));
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const URGENT_MS = 2 * 60_000; // FR-HOLD-15
