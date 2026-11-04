import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';

export const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
