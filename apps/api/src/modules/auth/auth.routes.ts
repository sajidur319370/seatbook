import { Router, type Request } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@seatbook/shared';
import { AppError } from '../../lib/errors';
import { validate, valid } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { access } from '../../middleware/access';
import {
  authLimiter,
  forgotLimiter,
  resetLimiter,
  signupLimiter,
} from '../../middleware/rateLimits';
import * as auth from './auth.service';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookies';

const meta = (req: Request): auth.ClientMeta => ({
  userAgent: req.get('user-agent') ?? '',
  ip: req.ip ?? '',
});
const cookie = (req: Request): string | undefined => req.cookies?.[REFRESH_COOKIE];

export const authRouter = Router();

const registerReq = { body: registerSchema };
authRouter.post(
  '/register',
  access('public'),
  signupLimiter,
  validate(registerReq),
  async (req, res) => {
    const { user, accessToken, refreshToken } = await auth.register(
      valid(req, registerReq).body,
      meta(req),
    );
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user, accessToken });
  },
);

const loginReq = { body: loginSchema };
authRouter.post('/login', access('public'), authLimiter, validate(loginReq), async (req, res) => {
  const { user, accessToken, refreshToken } = await auth.login(
    valid(req, loginReq).body,
    meta(req),
  );
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
});

authRouter.post('/refresh', access('public'), async (req, res) => {
  try {
    const { accessToken, refreshToken } = await auth.refresh(cookie(req), meta(req));
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  } catch (err) {
    // Only when the token or account was refused (401, or 403 if suspended):
    // a database blip must not log the user out.
    if (err instanceof AppError && err.status < 500) clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', access('self'), async (req, res) => {
  await auth.logout(cookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.post('/logout-all', access('self'), authenticate, async (req, res) => {
  await auth.logoutAll(req.userId);
  clearRefreshCookie(res);
  res.status(204).end();
});

const forgotReq = { body: forgotPasswordSchema };
authRouter.post(
  '/forgot-password',
  access('public'),
  forgotLimiter,
  validate(forgotReq),
  async (req, res) => {
    await auth.forgotPassword(valid(req, forgotReq).body.email);
    res.json({ ok: true }); // always 200
  },
);

const resetReq = { body: resetPasswordSchema };
authRouter.post(
  '/reset-password',
  access('public'),
  resetLimiter,
  validate(resetReq),
  async (req, res) => {
    const { token, password } = valid(req, resetReq).body;
    await auth.resetPassword(token, password);
    res.json({ ok: true });
  },
);
