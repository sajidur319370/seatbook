import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { SCAN_METHODS, SCAN_RESULTS } from '@seatbook/shared';

/** schema.md §12. The scanned code is never stored, only the ticket it resolved to. */
const scanSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', default: null }, // null for invalid codes
    result: { type: String, enum: SCAN_RESULTS, required: true },
    method: { type: String, enum: SCAN_METHODS, required: true },
    gate: { type: String, trim: true, maxlength: 30, default: null },
    scannedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'scans', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

scanSchema.index({ eventId: 1, createdAt: -1 }); // AP17 feed
scanSchema.index({ eventId: 1, result: 1 }); // duplicate-scan count
scanSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 }); // NFR-PRIV-03

export type ScanLean = InferSchemaType<typeof scanSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const Scan = model('Scan', scanSchema);
