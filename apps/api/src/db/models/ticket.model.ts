import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { CURRENCIES, TICKET_STATUSES } from '@seatbook/shared';

const ticketSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, immutable: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seatId: { type: Schema.Types.ObjectId, ref: 'Seat', required: true, immutable: true },
    seatKey: { type: Schema.Types.ObjectId, default: null }, // = seatId while live; null when void (I10)

    seatLabel: { type: String, required: true },
    sectionName: { type: String, required: true },
    row: { type: String, required: true },
    number: { type: Number, required: true },
    tierId: { type: Schema.Types.ObjectId, required: true },
    tierName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, required: true },
    holderName: { type: String, required: true },
    eventTitle: { type: String, required: true },
    eventStartsAt: { type: Date, required: true },

    manualCodeHash: { type: String, required: true }, // sha256(manual code); codes themselves are never stored
    status: { type: String, enum: TICKET_STATUSES, default: 'issued' },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null },
  },
  { collection: 'tickets', timestamps: true, versionKey: false },
);

// I10: one LIVE ticket per seat. Void tickets have seatKey = null and drop out of the index.
ticketSchema.index(
  { seatKey: 1 },
  {
    unique: true,
    partialFilterExpression: { seatKey: { $type: 'objectId' } },
    name: 'one_live_ticket_per_seat',
  },
);
// AP16 manual check-in, unique per event
ticketSchema.index({ eventId: 1, manualCodeHash: 1 }, { unique: true, name: 'uniq_manual_code' });
ticketSchema.index({ userId: 1, eventStartsAt: 1 }); // AP14 my tickets
ticketSchema.index({ bookingId: 1 }); // booking detail, cancellation
ticketSchema.index({ eventId: 1, status: 1 }); // AP19 dashboard, check-in counts
ticketSchema.index({ eventId: 1, _id: 1 }); // AP20 attendee list cursor

export type TicketLean = InferSchemaType<typeof ticketSchema> & { _id: Types.ObjectId };
export const Ticket = model('Ticket', ticketSchema);
