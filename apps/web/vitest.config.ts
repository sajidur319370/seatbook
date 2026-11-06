import { defineConfig } from 'vitest/config';

// Its own config: the unit tests are pure functions, and need none of Vite's plugins.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
