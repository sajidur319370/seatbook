import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { adminRouter } from './modules/admin/admin.routes';
import { applicationRouter } from './modules/applications/application.routes';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';

export const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
apiRouter.use('/organizer-applications', authenticate, applicationRouter);
apiRouter.use('/admin', authenticate, adminRouter);
