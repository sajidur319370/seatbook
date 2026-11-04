import { Types } from 'mongoose';

export const oid = (s: string) => new Types.ObjectId(s);
