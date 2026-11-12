import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_DEMO_PASSWORD!;
export type Who = 'attendee' | 'attendee2' | 'organizer' | 'admin';

/** A new browser context is its own cookie jar: its own logged-in user. */
export async function loginAs(browser: Browser, who: Who): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@demo.seatbook.dev`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Seats are buttons named "Orchestra, row F, seat 7, Standard, BDT 40.00, Available" (Day 13). */
export const SEAT_STATUS = {
  available: 'Available',
  mine: 'Selected by you',
  held: 'Held by someone else',
  sold: 'Sold',
} as const;

export const availableSeats = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`, ${SEAT_STATUS.available}$`) });

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A seat's description: its accessible name without the status at the end. Prices are formatted
 * with a non-breaking space ("BDT 75.00") and Playwright normalizes whitespace when it matches
 * names, so normalize here too.
 */
export const describeSeat = (accessibleName: string) =>
  accessibleName.replace(/\s+/g, ' ').replace(/, [^,]+$/, '');

/** The same seat in any page, whatever its status. */
export const seatNamed = (page: Page, description: string) =>
  page.getByRole('button', {
    name: new RegExp(`^${escapeRx(description).replace(/ /g, '\\s')}, `),
  });

export async function openSeatMap(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('link', { name: title }).first().click();
  await page.getByRole('link', { name: 'Choose seats' }).click();
  await expect(availableSeats(page).first()).toBeVisible();
}

/** 'YYYY-MM-DDTHH:mm' in Dhaka (the seeded organizer's profile zone), for datetime-local inputs. */
export function dhakaLocal(d: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}
