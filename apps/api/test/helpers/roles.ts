import { User } from '../../src/db/models';
import { registerUser } from './auth';

/** Promotions go straight to the DB in tests: the role is read per request, so the token keeps working. */
export async function makeOrganizer(name = 'Nadia Organizer') {
  const u = await registerUser(name);
  await User.updateOne(
    { _id: u.user.id },
    { $set: { role: 'organizer', organizationName: `${name} Productions` } },
  );
  return u;
}

export async function makeAdmin(name = 'Arif Admin') {
  const u = await registerUser(name);
  await User.updateOne({ _id: u.user.id }, { $set: { role: 'admin' } });
  return u;
}

export const makeAttendee = (name = 'Rafi Attendee') => registerUser(name);
