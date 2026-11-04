import { Schema, model, type InferSchemaType } from 'mongoose';
import { PALETTE, ROLES } from '@seatbook/shared';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    avatarColor: { type: String, enum: PALETTE, default: 'blue' },
    timezone: { type: String, default: 'UTC' },
    role: { type: String, enum: ROLES, default: 'attendee' },
    organizationName: { type: String, trim: true, maxlength: 80, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, maxlength: 500, default: null },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: true, versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index(
  { passwordResetTokenHash: 1 },
  { partialFilterExpression: { passwordResetTokenHash: { $type: 'string' } } },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
