import { execSync } from 'node:child_process';

/** A fresh demo before every run: the tests know its accounts and events (Day 20 Step 3). */
export default function globalSetup() {
  if (!process.env.SEED_DEMO_PASSWORD) throw new Error('Set SEED_DEMO_PASSWORD for the E2E run');
  execSync('npm run seed -- --reset', { stdio: 'inherit' });
}
