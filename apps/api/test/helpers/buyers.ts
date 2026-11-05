import { registerUser } from './auth';

/** n attendees in parallel (bcrypt rounds are 4 in tests, so this is fast). */
export const makeBuyers = (n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => registerUser(`Buyer ${i}`)));

export const holdUrl = (eventId: string) => `/api/events/${eventId}/hold`;
