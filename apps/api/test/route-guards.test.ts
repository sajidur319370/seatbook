import { describe, expect, it } from 'vitest';
import { apiRouter } from '../src/routes';

/**
 * FR-RBAC-01: every route under /api declares who may call it, either authorize(permission) or
 * access('public' | 'self'). Routes are discovered by walking the Express router, so a route added
 * next month without a guard fails CI.
 */

type Handler = { permission?: string; access?: string; stack?: Layer[] };
type Layer = {
  handle: Handler;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};

/** Every route, through nested routers. Paths are relative to their router ("…" marks a mount). */
function routes(stack: Layer[], prefix = ''): { name: string; handlers: Handler[] }[] {
  return stack.flatMap((l) => {
    if (l.route) {
      return Object.keys(l.route.methods).map((m) => ({
        name: `${m.toUpperCase()} ${prefix}${l.route!.path}`,
        handlers: l.route!.stack.map((s) => s.handle),
      }));
    }
    return l.handle.stack ? routes(l.handle.stack, `${prefix}…`) : [];
  });
}

describe('route guards (FR-RBAC-01)', () => {
  const all = routes((apiRouter as unknown as { stack: Layer[] }).stack);

  it('finds the routes', () => {
    expect(all.length).toBeGreaterThan(40); // grows with the app
  });

  it('every route declares a permission or an explicit access marker', () => {
    const naked = all
      .filter((r) => !r.handlers.some((h) => h.permission || h.access))
      .map((r) => r.name);
    expect(naked).toEqual([]);
  });

  it('nothing that writes is public except the auth endpoints', () => {
    const publicWrites = all
      .filter((r) => !r.name.startsWith('GET') && r.handlers.some((h) => h.access === 'public'))
      .map((r) => r.name.split(' ').at(-1)!.replace(/^…+/, ''));
    expect(publicWrites.sort()).toEqual(
      ['/forgot-password', '/login', '/refresh', '/register', '/reset-password'].sort(),
    );
  });
});
