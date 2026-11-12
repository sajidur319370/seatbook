import { expect, test } from '@playwright/test';
import {
  availableSeats,
  describeSeat,
  loginAs,
  openSeatMap,
  seatNamed,
  SEAT_STATUS,
} from './helpers';

/** AC-RT-01: a hold in one browser shows in the other within a second (plus CI slack). */
test('a hold in one browser appears in the other, and so does its release', async ({ browser }) => {
  const a = await loginAs(browser, 'attendee');
  const b = await loginAs(browser, 'attendee2');
  await openSeatMap(a, 'Hamlet — Evening Show');
  await openSeatMap(b, 'Hamlet — Evening Show');

  const description = describeSeat((await availableSeats(a).first().getAttribute('aria-label'))!);
  const inA = seatNamed(a, description);
  const inB = seatNamed(b, description);
  await expect(inB).toHaveAccessibleName(new RegExp(`${SEAT_STATUS.available}$`));

  await inA.click();
  await expect(inA).toHaveAttribute('aria-pressed', 'true'); // mine
  await expect(inB).toHaveAccessibleName(new RegExp(`${SEAT_STATUS.held}$`), { timeout: 1_500 });

  await inA.click(); // release
  await expect(inB).toHaveAccessibleName(new RegExp(`${SEAT_STATUS.available}$`), {
    timeout: 1_500,
  });
});
