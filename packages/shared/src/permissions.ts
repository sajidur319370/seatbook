import { ROLE_LEVEL, type Role } from './constants';

/**
 * Minimum role per permission (requirement §5.2).
 * ◐ rules (ownership: "own event", "own booking") are enforced in services by scoped finders.
 * Public permissions (event:browse, seatmap:view) aren't here: those routes need no login.
 */
export const PERMISSIONS = {
  'seat:hold': 'attendee',
  'booking:create': 'attendee',
  'booking:viewOwn': 'attendee',
  'booking:cancelOwn': 'attendee',
  'ticket:viewOwn': 'attendee',
  'organizer:apply': 'attendee',
  'event:create': 'organizer',
  'event:manage': 'organizer',
  'checkin:perform': 'organizer',
  'attendees:view': 'organizer',
  'dashboard:view': 'organizer',
  'admin:applications': 'admin',
  'admin:users': 'admin',
  'admin:events': 'admin',
  'admin:overview': 'admin',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role | null | undefined, p: Permission): boolean =>
  !!role && ROLE_LEVEL[role] >= ROLE_LEVEL[PERMISSIONS[p]];
