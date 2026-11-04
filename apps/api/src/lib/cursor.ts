import { Types } from 'mongoose';
import { badRequest } from './errors';

/** Opaque cursor over (createdAt, _id). */
export const encodeCursor = (d: { createdAt: Date; _id: Types.ObjectId }) =>
  Buffer.from(JSON.stringify({ t: d.createdAt.toISOString(), id: String(d._id) })).toString(
    'base64url',
  );

export function decodeCursor(c: string): { t: Date; id: Types.ObjectId } {
  try {
    const { t, id } = JSON.parse(Buffer.from(c, 'base64url').toString());
    return { t: new Date(t), id: new Types.ObjectId(id) };
  } catch {
    throw badRequest('INVALID_CURSOR');
  }
}
