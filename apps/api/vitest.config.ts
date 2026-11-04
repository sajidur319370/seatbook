import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://set-by-tests', // replaced by the in-memory server
      APP_URL: 'http://localhost:5173',
    },
    setupFiles: ['./test/setup/hooks.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000, // first run downloads the mongod binary
    pool: 'forks',
  },
});
