import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { apiUserLimiter } from './middleware/rateLimits';
import { adminRouter } from './modules/admin/admin.routes';
import { applicationRouter } from './modules/applications/application.routes';
import { authRouter } from './modules/auth/auth.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { checkoutRouter } from './modules/checkout/checkout.routes';
import { holdRouter } from './modules/holds/hold.routes';
import { publicEventsRouter } from './modules/events/public.routes';
import { organizerRouter } from './modules/organizer/organizer.routes';
import { meRouter } from './modules/users/me.routes';

export const apiRouter = Router();
/** Every authenticated route: who you are, then 300 requests a minute per user (NFR-SEC-07). */
const authed = [authenticate, apiUserLimiter];
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', ...authed, meRouter, bookingsRouter);
apiRouter.use('/organizer-applications', ...authed, applicationRouter);
apiRouter.use('/admin', ...authed, adminRouter);
apiRouter.use('/events/:eventId/hold', ...authed, holdRouter, checkoutRouter);
apiRouter.use('/events', publicEventsRouter); // public (optionalAuth per route)
apiRouter.use('/organizer', ...authed, organizerRouter);
