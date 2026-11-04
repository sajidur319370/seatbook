import { env } from '../config/env';

export const applicationApproved = (name: string, org: string) => ({
  subject: 'You can now create events on SeatBook',
  text: `Hi ${name},\n\n${org} is approved as an organizer. Create your first event: ${env.APP_URL}/organizer\n`,
});

export const applicationRejected = (name: string, reason: string) => ({
  subject: 'About your SeatBook organizer application',
  text: `Hi ${name},\n\nWe couldn't approve your application this time.\nReason: ${reason}\n\nYou can apply again in 7 days.\n`,
});

export const accountSuspended = (name: string, reason: string) => ({
  subject: 'Your SeatBook account is suspended',
  text: `Hi ${name},\n\nYour account was suspended. Reason: ${reason}\n`,
});
