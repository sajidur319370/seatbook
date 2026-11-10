import { Router } from 'express';
import { z } from 'zod';
import { objectIdSchema } from '@seatbook/shared';
import { oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { bookingDto } from './booking.dto';
import { listMyBookings, listMyTickets, myTicket } from './bookings.service';
import { findMyBooking } from './scope';

/** Mounted at /me behind `authenticate`, next to meRouter (routes.ts). */
export const bookingsRouter = Router();

const listReq = { query: z.object({ cursor: z.string().max(200).optional() }) };
bookingsRouter.get(
  '/bookings',
  authorize('booking:viewOwn'),
  validate(listReq),
  async (req, res) => {
    res.json(await listMyBookings(req.ctx, valid(req, listReq).query.cursor));
  },
);

const bookingReq = { params: z.object({ bookingId: objectIdSchema }) };
bookingsRouter.get(
  '/bookings/:bookingId',
  authorize('booking:viewOwn'),
  validate(bookingReq),
  async (req, res) => {
    const b = await findMyBooking(req.ctx, oid(valid(req, bookingReq).params.bookingId));
    res.json({ booking: await bookingDto(b) });
  },
);

const ticketsReq = {
  query: z.object({ when: z.enum(['upcoming', 'past']).default('upcoming') }),
};
bookingsRouter.get(
  '/tickets',
  authorize('ticket:viewOwn'),
  validate(ticketsReq),
  async (req, res) => {
    res.json(await listMyTickets(req.ctx, valid(req, ticketsReq).query.when));
  },
);

const ticketReq = { params: z.object({ ticketId: objectIdSchema }) };
bookingsRouter.get(
  '/tickets/:ticketId',
  authorize('ticket:viewOwn'),
  validate(ticketReq),
  async (req, res) => {
    const body = await myTicket(req.ctx, oid(valid(req, ticketReq).params.ticketId));
    res.set('Cache-Control', 'no-store'); // a ticket is a credential: no browser or proxy copies
    res.json(body);
  },
);
