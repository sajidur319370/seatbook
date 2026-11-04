import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { LoginInput, RegisterInput } from '@seatbook/shared';
import { Session, User } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { env, isProd } from '../../config/env';
import { badRequest, unauthenticated } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';
import { addDays, addMinutes } from '../../lib/dates';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password';
import { signAccessToken } from '../../lib/tokens';
import { logger } from '../../lib/logger';
import { toUserDto } from '../users/user.dto';

const REFRESH_DAYS = 7;
export interface ClientMeta {
  userAgent: string;
  ip: string;
}

async function startSession(userId: Types.ObjectId, meta: ClientMeta) {
  const refreshToken = randomToken(32);
  const session = await Session.create({
    userId,
    familyId: randomUUID(), // a new login = a new family
    tokenHash: sha256(refreshToken),
    expiresAt: addDays(new Date(), REFRESH_DAYS),
    userAgent: meta.userAgent.slice(0, 300),
    ip: meta.ip,
  });
  const accessToken = signAccessToken({ userId: String(userId), sessionId: String(session._id) });
  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, meta: ClientMeta) {
  // E11000 on uniq_email → 409 EMAIL_TAKEN (mapped in errorHandler)
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
  return { user: toUserDto(user), ...(await startSession(user._id, meta)) };
}

export async function login(input: LoginInput, meta: ClientMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash').lean();
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthenticated('INVALID_CREDENTIALS', 'Invalid email or password');
  return { user: toUserDto(user), ...(await startSession(user._id, meta)) };
}

export async function refresh(presented: string | undefined, meta: ClientMeta) {
  if (!presented) throw unauthenticated();
  const now = new Date();
  const s = await Session.findOne({ tokenHash: sha256(presented) }).lean();
  if (!s) throw unauthenticated();

  if (s.replacedByHash || s.revokedAt) {
    // A rotated or revoked token came back: assume theft and kill the whole family.
    await Session.updateMany(
      { familyId: s.familyId, revokedAt: null },
      { $set: { revokedAt: now } },
    );
    throw unauthenticated('SESSION_REVOKED', 'Please log in again.');
  }
  if (s.expiresAt <= now) throw unauthenticated('TOKEN_EXPIRED', 'Please log in again.');

  const next = randomToken(32);
  const created = await withTransaction(async (session) => {
    // CAS: only one concurrent refresh can claim this token.
    const claimed = await Session.findOneAndUpdate(
      { _id: s._id, replacedByHash: null, revokedAt: null },
      { $set: { replacedByHash: sha256(next) } },
      { session },
    );
    if (!claimed) throw unauthenticated('SESSION_REVOKED', 'Please log in again.');

    const [doc] = await Session.create(
      [
        {
          userId: s.userId,
          familyId: s.familyId,
          tokenHash: sha256(next),
          expiresAt: addDays(now, REFRESH_DAYS),
          userAgent: meta.userAgent.slice(0, 300),
          ip: meta.ip,
        },
      ],
      { session },
    );
    return doc!;
  });

  return {
    refreshToken: next,
    accessToken: signAccessToken({ userId: String(s.userId), sessionId: String(created._id) }),
  };
}

export async function logout(presented: string | undefined) {
  if (!presented) return;
  const s = await Session.findOne({ tokenHash: sha256(presented) })
    .select('familyId')
    .lean();
  if (s)
    await Session.updateMany(
      { familyId: s.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
}

export async function logoutAll(userId: Types.ObjectId) {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function forgotPassword(email: string) {
  const token = randomToken(32);
  const res = await User.updateOne(
    { email },
    {
      $set: {
        passwordResetTokenHash: sha256(token),
        passwordResetExpiresAt: addMinutes(new Date(), 30),
      },
    },
  );
  // Dev mailer: print the link. (Production email via Resend is optional; see Day 20.)
  if (res.matchedCount === 1 && !isProd) {
    logger.info(`🔑 Password reset link: ${env.APP_URL}/reset-password/${token}`);
  }
  // Always return normally: the response must not reveal whether the email exists.
}

export async function resetPassword(token: string, newPassword: string) {
  const now = new Date();
  // Single use: the same write that changes the password clears the token (CAS).
  const user = await User.findOneAndUpdate(
    { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { $gt: now } },
    {
      $set: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: now,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    },
  ).lean();
  if (!user)
    throw badRequest('INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired.');
  await logoutAll(user._id); // AC-AUTH-04
}

export async function changePassword(
  userId: Types.ObjectId,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await User.findById(userId).select('+passwordHash').lean(); // a user always reads their own document
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  await User.updateOne(
    { _id: userId },
    { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } },
  );
  // Revoke every OTHER login (FR-AUTH-13); keep the current family alive.
  const current = await Session.findById(currentSessionId).select('familyId').lean();
  await Session.updateMany(
    { userId, revokedAt: null, ...(current && { familyId: { $ne: current.familyId } }) },
    { $set: { revokedAt: new Date() } },
  );
}
