export const qk = {
  me: ['me'] as const,
  adminApplications: (status: string) => ['admin', 'applications', status] as const,
  adminUsers: (q: object) => ['admin', 'users', q] as const,
  adminEvents: (q: object) => ['admin', 'events', q] as const,
  myEvents: (status?: string) => ['organizer', 'events', status ?? 'all'] as const,
  organizerEvent: (id: string) => ['organizer', 'event', id] as const,
  seatMap: (id: string) => ['seatmap', id] as const,
  hold: (eventId: string) => ['hold', eventId] as const,
  // Under ['me'], so a logout or an account change (which invalidate qk.me) refreshes them too.
  myBookings: ['me', 'bookings'] as const,
  myBooking: (id: string) => ['me', 'bookings', id] as const,
  myTickets: (when: 'upcoming' | 'past') => ['me', 'tickets', when] as const,
  myTicket: (id: string) => ['me', 'ticket', id] as const,
  dashboard: (scope: 'organizer' | 'admin', id: string) => ['dashboard', scope, id] as const,
  attendees: (id: string, q: string) => ['organizer', 'attendees', id, q] as const,
  organizerOverview: ['organizer', 'overview'] as const,
  adminOverview: ['admin', 'overview'] as const,
};
