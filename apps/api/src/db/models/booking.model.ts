import { Schema, model } from 'mongoose';

/** Stub so unpublish can check for bookings today. Day 16 replaces it with schema.md §10. */
const bookingSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    holdId: { type: Schema.Types.ObjectId, ref: 'Hold', required: true },
  },
  { collection: 'bookings', versionKey: false },
);

export const Booking = model('Booking', bookingSchema);
