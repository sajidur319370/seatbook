import { expect, test } from '@playwright/test';
import {
  availableSeats,
  describeSeat,
  dhakaLocal,
  loginAs,
  seatNamed,
  SEAT_STATUS,
} from './helpers';

/**
 * Build → buy → check in, end to end. Its OWN event, starting in 3 hours: check-in opens 6 h
 * before the start (FR-CHK-08), and no seeded event is that close. Serial: each step needs the
 * one before.
 */
test.describe.serial('organizer builds, attendee buys, the door checks in', () => {
  const title = `E2E Tonight ${Date.now().toString(36)}`;
  let eventPath = ''; // /organizer/events/:id
  let manualCode = '';

  test('the organizer creates, lays out and publishes an event', async ({ browser }) => {
    const org = await loginAs(browser, 'organizer');
    await org.goto('/organizer/events/new');
    const start = new Date(Date.now() + 3 * 3_600_000);
    await org.getByLabel('Title').fill(title);
    await org.locator('#venue-name').fill('E2E Hall');
    await org.locator('#venue-city').fill('Dhaka');
    await org.locator('#startsAt').fill(dhakaLocal(start));
    await org.locator('#endsAt').fill(dhakaLocal(new Date(+start + 2 * 3_600_000)));
    await org.getByRole('button', { name: 'Create draft' }).click();
    await expect(org).toHaveURL(/\/organizer\/events\/[a-f0-9]{24}$/);
    eventPath = new URL(org.url()).pathname;

    await org.getByRole('tab', { name: 'Seat map' }).click();
    await org.getByRole('button', { name: 'Small theatre' }).click();
    await org.getByRole('button', { name: 'Save seat map' }).click();
    await expect(org.getByText('Seat map saved')).toBeVisible(); // the button turns disabled: nothing to save
    await org.getByRole('tab', { name: 'Publish' }).click();
    await org.getByRole('button', { name: 'Publish', exact: true }).click();
    await org.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
    await expect(org.getByText('Your event is published')).toBeVisible();

    await org.goto('/');
    await expect(org.getByRole('link', { name: title })).toBeVisible(); // public now
  });

  test('an attendee buys two seats and gets two QR tickets', async ({ browser }) => {
    const me = await loginAs(browser, 'attendee');
    await me.goto('/');
    await me.getByRole('link', { name: title }).click();
    await me.getByRole('link', { name: 'Choose seats' }).click();
    for (let i = 0; i < 2; i++) {
      const seat = availableSeats(me).first();
      const description = describeSeat((await seat.getAttribute('aria-label'))!);
      await seat.click();
      await expect(seatNamed(me, description)).toHaveAccessibleName(
        new RegExp(`${SEAT_STATUS.mine}$`),
      );
    }
    await me.getByRole('link', { name: 'Checkout' }).first().click();

    await me.getByLabel('Name on card').fill('Rafi Ahmed');
    await me.locator('#cc-number').fill('4242 4242 4242 4242');
    await me.getByLabel('Expiry').fill('12/28');
    await me.getByLabel('CVC').fill('123');
    await me.getByRole('button', { name: /^Pay / }).click();

    await expect(me).toHaveURL(/\/bookings\/[a-f0-9]{24}$/);
    await expect(me.getByText(/SB-[0-9A-Z]{4}-[0-9A-Z]{4}/)).toBeVisible();
    const tickets = me.getByRole('link', { name: /Valid/ });
    await expect(tickets).toHaveCount(2);

    await tickets.first().click();
    await expect(me.getByRole('img', { name: /QR code for seat/ })).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    );
    manualCode = (await me.getByLabel('Manual code').textContent())!.trim();
    expect(manualCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
  });

  test('the door: Welcome, then Already used, and the dashboard moves live', async ({
    browser,
  }) => {
    const dashboard = await loginAs(browser, 'organizer');
    await dashboard.goto(`${eventPath}/dashboard`);
    await expect(dashboard.getByTestId('kpi-sold')).toHaveText('2');
    await expect(dashboard.getByTestId('kpi-checked-in')).toHaveText('0');

    const door = await dashboard.context().newPage(); // same organizer, a second tab
    await door.goto(`${eventPath}/check-in`);
    const typeCode = async () => {
      await door.getByLabel('Manual code').fill(manualCode.toLowerCase()); // typed sloppily
      await door.getByRole('button', { name: 'Check', exact: true }).click();
    };
    await typeCode();
    await expect(door.getByTestId('scan-result')).toContainText('Welcome');
    await door.getByTestId('scan-result').click(); // dismiss
    await typeCode();
    await expect(door.getByTestId('scan-result')).toContainText('Already used');

    // No reload: the staff room pushed both scans to the dashboard tab.
    await expect(dashboard.getByTestId('kpi-checked-in')).toHaveText('1');
    await expect(dashboard.getByTestId('kpi-duplicates')).toHaveText('1');
  });
});
