import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node26',
  noExternal: ['@seatbook/shared'], // shared has no build step, so it's inlined into the bundle
  clean: true,
});
