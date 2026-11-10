/**
 * "Fri, 14 Nov 2026, 19:30 GMT+6" (FR-EVT-10). In its own file because it's all `Intl`: guests
 * need it, and they shouldn't download date-fns-tz, which only the organizer's forms use.
 */
export const formatEventTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short',
  }).format(new Date(iso));

/** The same moment in the viewer's own zone, or null if that reads the same as the event's. */
export function viewerTimeIfDifferent(iso: string, eventZone: string) {
  const viewer = formatEventTime(iso, Intl.DateTimeFormat().resolvedOptions().timeZone);
  return viewer === formatEventTime(iso, eventZone) ? null : viewer;
}

/** "19:42" in the event's zone: when a ticket was scanned at the door. */
export const formatTimeOfDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
    new Date(iso),
  );
