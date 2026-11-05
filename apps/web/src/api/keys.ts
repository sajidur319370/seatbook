export const qk = {
  me: ['me'] as const,
  adminApplications: (status: string) => ['admin', 'applications', status] as const,
  adminUsers: (q: object) => ['admin', 'users', q] as const,
  adminEvents: (q: object) => ['admin', 'events', q] as const,
  myEvents: (status?: string) => ['organizer', 'events', status ?? 'all'] as const,
  organizerEvent: (id: string) => ['organizer', 'event', id] as const,
  seatMap: (id: string) => ['seatmap', id] as const,
  // Day 11+: holds…
};
