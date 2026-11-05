import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** "2026-11-14T19:30" typed in a datetime-local input, MEANT in `tz` → ISO UTC for the API. */
export const localInputToIso = (value: string, tz: string) =>
  fromZonedTime(value, tz).toISOString();

/** ISO from the API → the value a datetime-local input shows, in `tz`. */
export const isoToLocalInput = (iso: string, tz: string) =>
  formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm");
