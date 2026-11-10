/**
 * The event this tab is paying for right now, if any. The `booking:confirmed` socket message reaches
 * every tab of the buyer, including this one, often before the HTTP answer does. This tab navigates
 * to the booking by itself, so it skips the "Booking confirmed" toast.
 */
let payingEventId: string | null = null;

export const setPayingEvent = (eventId: string | null) => {
  payingEventId = eventId;
};
export const isPayingFor = (eventId: string) => payingEventId === eventId;
