/** "Fri, 14 Nov 2026, 19:30 GMT+6": the same format as the web app's formatEventTime (FR-EVT-10). */
export const formatEventTimeServer = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short',
  }).format(d);
