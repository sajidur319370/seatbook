import type { Types } from 'mongoose';
import type { Role, UserDto } from '@seatbook/shared';

type UserLike = {
  _id: Types.ObjectId;
  email: string;
  name: string;
  avatarColor?: string | null;
  timezone?: string | null;
  role?: Role | null;
  organizationName?: string | null;
};

export function toUserDto(u: UserLike): UserDto {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    avatarColor: u.avatarColor ?? 'blue',
    timezone: u.timezone ?? 'UTC',
    role: u.role ?? 'attendee',
    organizationName: u.organizationName ?? null,
  };
}
