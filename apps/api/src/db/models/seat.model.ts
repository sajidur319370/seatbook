import { Schema, model, type InferSchemaType } from 'mongoose';
import { SEAT_STATUSES } from '@seatbook/shared';

const seatSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, immutable: true },
    sectionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    row: { type: String, required: true, immutable: true },
    number: { type: Number, required: true, immutable: true },
    label: { type: String, required: true, immutable: true }, // ORC-A12
    tierId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    price: { type: Number, required: true, min: 0, immutable: true }, // copied from tier at publish
    x: { type: Number, required: true, immutable: true },
    y: { type: Number, required: true, immutable: true },

    status: { type: String, enum: SEAT_STATUSES, default: 'available' },
    holdId: { type: Schema.Types.ObjectId, ref: 'Hold', default: null },
    heldBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    holdExpiresAt: { type: Date, default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    version: { type: Number, default: 1, min: 1 },
  },
  { collection: 'seats', versionKey: false }, // no timestamps: see schema.md §1
);

// Invariant I3 + seat-map load (prefix eventId)  · AP4
seatSchema.index(
  { eventId: 1, sectionId: 1, row: 1, number: 1 },
  { unique: true, name: 'uniq_seat_position' },
);
// Remaining seats per tier  · AP5
seatSchema.index({ eventId: 1, status: 1, tierId: 1 });
// Sweeper: only HELD seats are in this index, so it stays tiny  · AP9
seatSchema.index(
  { holdExpiresAt: 1 },
  { partialFilterExpression: { status: 'held' }, name: 'sweep_expired_holds' },
);
// Checkout / release-all: seats of a hold  · AP11
seatSchema.index({ holdId: 1 }, { partialFilterExpression: { holdId: { $type: 'objectId' } } });
// Booking cancellation (Should), invariant checker
seatSchema.index(
  { bookingId: 1 },
  { partialFilterExpression: { bookingId: { $type: 'objectId' } } },
);

export type SeatDoc = InferSchemaType<typeof seatSchema>;
export const Seat = model('Seat', seatSchema);

/** Use in every write that leaves the 'held' state (invariant I16). */
export const CLEAR_HOLD = { holdId: null, heldBy: null, holdExpiresAt: null } as const;

/** Seat-map projection (FR-VIEW-01). */
export const SEAT_MAP_FIELDS = '_id sectionId row number x y tierId status version holdExpiresAt';
