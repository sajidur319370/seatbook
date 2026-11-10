import { randomUUID } from 'node:crypto';
import { as } from './auth';

/** One Pay click. Pass the same key to simulate a retry of the same payment. */
export const pay = (
  token: string,
  eventId: string,
  paymentToken = 'tok_visa',
  key = randomUUID(),
) =>
  as(token)
    .post(`/api/events/${eventId}/hold/checkout`)
    .set('Idempotency-Key', key)
    .send({ paymentToken });

export async function holdSeats(token: string, eventId: string, seatIds: string[]) {
  for (const seatId of seatIds) {
    const r = await as(token).post(`/api/events/${eventId}/hold/seats`).send({ seatId });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
}
