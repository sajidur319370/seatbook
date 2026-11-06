import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  objectIdSchema,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@seatbook/shared';
import { env, isProd } from '../config/env';
import { Event, User } from '../db/models';
import { AppError } from '../lib/errors';
import { oid } from '../lib/ids';
import { logger } from '../lib/logger';
import { verifyAccessToken } from '../lib/tokens';

export type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
let io: IO | null = null;
export const getIO = () => io;

const eventPayload = z.object({ eventId: objectIdSchema });

export function attachSocketServer(httpServer: HttpServer): IO {
  io = new Server(httpServer, {
    serveClient: false,
    cors: isProd ? undefined : { origin: env.APP_URL, credentials: true }, // production is same-origin
  });

  // ---- handshake (FR-RT-01): the token, then the live role and suspension ----
  io.use(async (socket, next) => {
    try {
      const { userId } = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
      const user = await User.findById(userId).select('role suspendedAt').lean();
      if (!user) return next(new Error('UNAUTHENTICATED'));
      if (user.suspendedAt) return next(new Error('ACCOUNT_SUSPENDED'));
      socket.data.userId = userId;
      socket.data.role = user.role;
      next();
    } catch (err) {
      // A database blip isn't a bad token: the client must not refresh or log out because of it.
      if (!(err instanceof AppError)) logger.error({ err }, 'socket handshake failed');
      next(new Error(err instanceof AppError ? err.code : 'INTERNAL_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`); // FR-RT-02
    const isAdmin = socket.data.role === 'admin';
    const me = oid(socket.data.userId);
    // A join waits for the database, and a leave doesn't. Only the latest request may take effect.
    let latestEventRequest = 0;

    /**
     * Both joins: check the input, ask the database, answer. An error here must be caught, because
     * an async listener's rejection is unhandled, and that stops the whole server.
     */
    const handleJoin =
      (allowed: (eventId: string) => Promise<unknown>, join: (eventId: string) => void) =>
      async (payload: unknown, ack: unknown) => {
        const done = typeof ack === 'function' ? (ack as (r: Ack) => void) : () => {};
        const p = eventPayload.safeParse(payload);
        if (!p.success) return done({ ok: false, code: 'VALIDATION_ERROR' });
        try {
          if (!(await allowed(p.data.eventId))) return done({ ok: false, code: 'NOT_FOUND' }); // AC-RT-02
          join(p.data.eventId);
          done({ ok: true });
        } catch (err) {
          logger.error({ err }, 'socket join failed');
          done({ ok: false, code: 'INTERNAL_ERROR' });
        }
      };

    socket.on('event:join', (payload, ack) => {
      const request = ++latestEventRequest;
      void handleJoin(
        // Published events are public; drafts only for their organizer or an admin (FR-RT-03).
        (id) =>
          Event.exists({
            _id: oid(id),
            ...(!isAdmin && { $or: [{ status: { $ne: 'draft' } }, { organizerId: me }] }),
          }),
        (id) => {
          if (request !== latestEventRequest) return;
          for (const room of socket.rooms) if (room.startsWith('event:')) void socket.leave(room); // one map at a time
          void socket.join(`event:${id}`);
        },
      )(payload, ack);
    });

    socket.on('event:leave', (payload) => {
      latestEventRequest += 1;
      const p = eventPayload.safeParse(payload);
      if (p.success) void socket.leave(`event:${p.data.eventId}`);
    });

    socket.on(
      'staff:join',
      handleJoin(
        (id) => Event.exists({ _id: oid(id), ...(!isAdmin && { organizerId: me }) }), // FR-RT-04
        (id) => void socket.join(`staff:${id}`),
      ),
    );

    socket.on('staff:leave', (payload) => {
      const p = eventPayload.safeParse(payload);
      if (p.success) void socket.leave(`staff:${p.data.eventId}`);
    });

    logger.debug({ userId: socket.data.userId }, 'socket connected');
  });

  return io;
}
