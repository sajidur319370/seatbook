import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { HOLD_STATUSES, LIMITS } from '@seatbook/shared';

const holdSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    seatIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Seat' }],
      default: [],
      validate: { validator: (a: unknown[]) => a.length <= LIMITS.maxSeatsPerOrder },
    },
    status: { type: String, enum: HOLD_STATUSES, default: 'active' },
    expiresAt: { type: Date, required: true },
    checkoutStartedAt: { type: Date, default: null }, // checkout lock
    checkoutAttempts: { type: Number, default: 0, min: 0 },
  },
  { collection: 'holds', timestamps: true, versionKey: false },
);

// Invariant I5: one ACTIVE hold per user per event  · AP7
holdSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_hold' },
);
// Sweeper: active holds past expiry  · AP10
holdSchema.index({ status: 1, expiresAt: 1 });
// Anti-hoarding: my active holds across events  · AP8
holdSchema.index({ userId: 1, status: 1 });
// TTL: delete hold documents 1 hour after they expire (cleanup only, data-model.md §12.3)
holdSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60, name: 'ttl_hold_cleanup' });

export type HoldLean = InferSchemaType<typeof holdSchema> & { _id: Types.ObjectId };
export const Hold = model('Hold', holdSchema);
