import type { Types } from 'mongoose';
import type { Role } from '@seatbook/shared';
import { Event, Hold, OrganizerApplication, Session, User, type HoldLean } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { escapeRegex } from '../../lib/regex';
import { sendMail } from '../../mail/mailer';
import { applicationApproved, applicationRejected, accountSuspended } from '../../mail/templates';
import { releaseAllSeats } from '../holds/hold.service';
import { systemCtx, type Ctx } from '../../types/ctx';

const alreadyReviewed = () =>
  conflict('APPLICATION_ALREADY_REVIEWED', 'This application was already reviewed.');

// ---------- applications (queries.md §4.2) ----------

export async function listApplications(
  status: 'pending' | 'approved' | 'rejected',
  cursor?: string,
) {
  const filter: Record<string, unknown> = { status };
  if (cursor) {
    const { t, id } = decodeCursor(cursor);
    filter.$or = [{ createdAt: { $gt: t } }, { createdAt: t, _id: { $gt: id } }];
  }
  const rows = await OrganizerApplication.find(filter)
    .sort({ createdAt: 1, _id: 1 }) // oldest first: a queue (index { status, createdAt })
    .limit(51)
    .populate('userId', 'name email')
    .lean();
  const page = rows.slice(0, 50);
  return { items: page, nextCursor: rows.length > 50 ? encodeCursor(page.at(-1)!) : null };
}

export async function approveApplication(ctx: Ctx, applicationId: Types.ObjectId) {
  const app = await withTransaction(async (session) => {
    const a = await OrganizerApplication.findOneAndUpdate(
      { _id: applicationId, status: 'pending' }, // CAS: only one admin wins (AC-APP-01)
      { $set: { status: 'approved', reviewedBy: ctx.userId, reviewedAt: ctx.now() } },
      { new: true, session },
    ).lean();
    if (!a) {
      const exists = await OrganizerApplication.exists({ _id: applicationId }).session(session);
      throw exists ? alreadyReviewed() : notFound();
    }
    await User.updateOne(
      { _id: a.userId, role: 'attendee' },
      { $set: { role: 'organizer', organizationName: a.organizationName } },
      { session },
    );
    return a;
  });

  // After commit: email (Day 14 adds the socket push account:changed)
  const user = await User.findById(app.userId).select('name email').lean();
  if (user) sendMail({ to: user.email, ...applicationApproved(user.name, app.organizationName) });
  return app;
}

export async function rejectApplication(ctx: Ctx, applicationId: Types.ObjectId, reason: string) {
  const a = await OrganizerApplication.findOneAndUpdate(
    { _id: applicationId, status: 'pending' },
    {
      $set: {
        status: 'rejected',
        reviewedBy: ctx.userId,
        reviewedAt: ctx.now(),
        rejectionReason: reason,
      },
    },
    { new: true },
  ).lean();
  if (!a)
    throw (await OrganizerApplication.exists({ _id: applicationId }))
      ? alreadyReviewed()
      : notFound();

  const user = await User.findById(a.userId).select('name email').lean();
  if (user) sendMail({ to: user.email, ...applicationRejected(user.name, reason) });
  return a;
}

// ---------- users (queries.md §4.3–4.4) ----------

export async function listUsers(q: {
  q?: string;
  role?: Role;
  suspended?: boolean;
  cursor?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (q.q) {
    const term = escapeRegex(q.q.trim());
    filter.$or = [
      { email: { $regex: '^' + term.toLowerCase() } },
      { name: { $regex: term, $options: 'i' } },
    ];
  }
  if (q.role) filter.role = q.role;
  if (q.suspended !== undefined) filter.suspendedAt = q.suspended ? { $ne: null } : null;
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await User.find(filter)
    .sort({ _id: -1 })
    .limit(51)
    .select('name email role organizationName suspendedAt createdAt')
    .lean();
  const page = rows.slice(0, 50);
  return { items: page, nextCursor: rows.length > 50 ? String(page.at(-1)!._id) : null };
}

/** One query for a whole page of events, instead of one per row. */
export async function organizerNames(ids: Types.ObjectId[]) {
  const users = await User.find({ _id: { $in: ids } })
    .select('organizationName name')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.organizationName ?? u.name]));
}

export async function updateUser(
  ctx: Ctx,
  targetId: Types.ObjectId,
  patch: { role?: 'attendee' | 'organizer'; suspended?: boolean; reason?: string },
) {
  if (targetId.equals(ctx.userId))
    throw forbidden('FORBIDDEN', "You can't change your own account here.");
  const now = ctx.now();

  if (patch.role) {
    if (patch.role === 'attendee') {
      const live = await Event.exists({
        organizerId: targetId,
        status: 'published',
        'counters.seatsSold': { $gt: 0 },
      });
      if (live)
        throw conflict(
          'ORGANIZER_HAS_LIVE_EVENTS',
          'This organizer has published events with sales.',
        ); // FR-ADM-02
    }
    const u = await User.findOneAndUpdate(
      { _id: targetId, role: { $ne: 'admin' } }, // ceiling in the filter (FR-ADM-04, I19)
      { $set: { role: patch.role } },
      { new: true },
    ).lean();
    if (!u) throw (await User.exists({ _id: targetId })) ? forbidden() : notFound();
  }

  if (patch.suspended === true) {
    const u = await User.findOneAndUpdate(
      { _id: targetId, role: { $ne: 'admin' }, suspendedAt: null },
      { $set: { suspendedAt: now, suspendedReason: patch.reason ?? 'No reason given' } },
      { new: true },
    ).lean();
    if (!u) {
      const t = await User.findById(targetId).select('role suspendedAt').lean();
      if (!t) throw notFound();
      if (t.role === 'admin') throw forbidden();
      throw conflict('ALREADY_SUSPENDED', 'This user is already suspended.');
    }
    await Session.updateMany({ userId: targetId, revokedAt: null }, { $set: { revokedAt: now } });
    // Their seats go back on sale (AC-ADM-02).
    const holds = await Hold.find({ userId: targetId, status: 'active' })
      .select('_id eventId userId')
      .lean<Pick<HoldLean, '_id' | 'eventId' | 'userId'>[]>();
    for (const h of holds) await releaseAllSeats(systemCtx(now), h);
    sendMail({ to: u.email, ...accountSuspended(u.name, u.suspendedReason!) });
  }

  if (patch.suspended === false) {
    const res = await User.updateOne(
      { _id: targetId, role: { $ne: 'admin' } },
      { $set: { suspendedAt: null, suspendedReason: null } },
    );
    if (!res.matchedCount) throw (await User.exists({ _id: targetId })) ? forbidden() : notFound();
  }

  return User.findById(targetId)
    .select('name email role organizationName suspendedAt createdAt')
    .lean();
}
