import { Schema, model } from 'mongoose';
import { HOLD_STATUSES } from '@seatbook/shared';

/** Stub so unpublish can release holds today. Day 11 replaces it with schema.md §9. */
const holdSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: HOLD_STATUSES, default: 'active' },
  },
  { collection: 'holds', versionKey: false },
);

export const Hold = model('Hold', holdSchema);
