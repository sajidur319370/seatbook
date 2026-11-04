import { Schema, model } from 'mongoose';
import { APPLICATION_STATUSES } from '@seatbook/shared';

const applicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    organizationName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    website: { type: String, trim: true, maxlength: 200, default: null },
    message: { type: String, required: true, trim: true, minlength: 20, maxlength: 1000 },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, maxlength: 500, default: null },
  },
  { collection: 'organizerApplications', timestamps: true, versionKey: false },
);

applicationSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_application' },
);
applicationSchema.index({ status: 1, createdAt: 1 }); // admin queue, oldest first
applicationSchema.index({ userId: 1, createdAt: -1 }); // "mine", re-apply cooldown

export const OrganizerApplication = model('OrganizerApplication', applicationSchema);
