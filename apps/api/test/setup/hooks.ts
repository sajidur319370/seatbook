import { afterAll, beforeAll, beforeEach } from 'vitest';
import { clearTestDb, startTestDb, stopTestDb } from './db';

beforeAll(startTestDb);
beforeEach(clearTestDb);
afterAll(stopTestDb);
