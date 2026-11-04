import { connectDb, disconnectDb } from '../src/db/connection';
import { User } from '../src/db/models';

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin -- someone@example.com');
  process.exit(1);
}

await connectDb();
const res = await User.updateOne(
  { email },
  { $set: { role: 'admin', suspendedAt: null, suspendedReason: null } },
);
if (res.matchedCount) {
  console.log(`✅ ${email} is now an admin`);
} else {
  console.error(`❌ No user with email ${email} (register first)`);
  process.exitCode = 1;
}
await disconnectDb();
