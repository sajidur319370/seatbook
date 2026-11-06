import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '../../src/app';
import { attachSocketServer } from '../../src/realtime/socket';

export async function startServer() {
  const server = createServer(createApp());
  const io = attachSocketServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => io.close() }; // closes the http server too
}

export function connect(port: number, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

export const emitAck = <T = unknown>(s: Socket, event: string, payload: unknown) =>
  new Promise<T>((r) => s.emit(event, payload, r));

export function nextEvent<T = unknown>(s: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

/** Every message of one type until the time is up: for counting batches. */
export async function collect<T = unknown>(s: Socket, event: string, ms = 700): Promise<T[]> {
  const got: T[] = [];
  const h = (p: T) => got.push(p);
  s.on(event, h);
  await new Promise((r) => setTimeout(r, ms));
  s.off(event, h);
  return got;
}

export async function expectNoEvent(s: Socket, event: string, ms = 500) {
  const got = await collect(s, event, ms);
  if (got.length) throw new Error(`unexpected ${event}: ${JSON.stringify(got[0])}`);
}
