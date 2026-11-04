import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** "2026-11-14T19:30" typed in a datetime-local input, MEANT in `tz` → ISO UTC for the API. */
export const localInputToIso = (value: string, tz: string) =>
  fromZonedTime(value, tz).toISOString();

/** ISO from the API → the value a datetime-local input shows, in `tz`. */
export const isoToLocalInput = (iso: string, tz: string) =>
  formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm");

/** "Fri 14 Nov 2026, 19:30 GMT+6" (FR-EVT-10) */
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
