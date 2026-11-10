import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { BOOKING_STATUSES, CURRENCIES, type Currency } from '@seatbook/shared';

const bookingItemSchema = new Schema(
  {
    seatId: { type: Schema.Types.ObjectId, required: true },
    label: { type: String, required: true },
    sectionName: { type: String, required: true },
    row: { type: String, required: true },
    number: { type: Number, required: true },
    tierId: { type: Schema.Types.ObjectId, required: true },
    tierName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const bookingSchema = new Schema(
  {
    reference: { type: String, required: true, immutable: true }, // SB-7KQ2-9XF3
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, immutable: true },
    holdId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    items: { type: [bookingItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, required: true },
    buyer: {
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    event: {
      // snapshot (data-model.md §8)
      title: { type: String, required: true },
      slug: { type: String, required: true },
      startsAt: { type: Date, required: true },
      venueName: { type: String, required: true },
      city: { type: String, required: true },
      timezone: { type: String, required: true },
    },
    payment: {
      provider: { type: String, default: 'mock' },
      chargeId: { type: String, required: true },
      brand: { type: String, default: null },
      last4: { type: String, default: null },
      amount: { type: Number, required: true },
      paidAt: { type: Date, required: true },
      refundId: { type: String, default: null },
      refundedAt: { type: Date, default: null },
    },
    status: { type: String, enum: BOOKING_STATUSES, default: 'confirmed' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, enum: ['user', 'event_cancelled', 'admin'], default: null }, // null passes enum validation
  },
  { collection: 'bookings', timestamps: true, versionKey: false },
);

bookingSchema.index({ reference: 1 }, { unique: true, name: 'uniq_booking_reference' });
bookingSchema.index({ holdId: 1 }, { unique: true, name: 'uniq_booking_hold' }); // I8
bookingSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_idempotency' }); // I9
bookingSchema.index({ userId: 1, createdAt: -1 }); // AP13 my bookings
bookingSchema.index({ eventId: 1, status: 1, createdAt: 1 }); // AP18 dashboard
bookingSchema.index({ status: 1, createdAt: -1 }); // AP24 admin GMV

type BookingDoc = InferSchemaType<typeof bookingSchema>;
/** Mongoose infers nested objects as optional, but the schema requires them. */
export type BookingLean = Omit<BookingDoc, 'buyer' | 'event' | 'payment' | 'currency'> & {
  _id: Types.ObjectId;
  currency: Currency;
  buyer: { name: string; email: string };
  event: {
    title: string;
    slug: string;
    startsAt: Date;
    venueName: string;
    city: string;
    timezone: string;
  };
  payment: {
    provider: string;
    chargeId: string;
    brand: string | null;
    last4: string | null;
    amount: number;
    paidAt: Date;
    refundId: string | null;
    refundedAt: Date | null;
  };
  createdAt: Date;
  updatedAt: Date;
};
export const Booking = model('Booking', bookingSchema);
