import type { Config, Context } from '@netlify/functions';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { clean } from '../../lib/validation.mjs';

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function reply(status: number, body?: unknown, extra: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
  return body;
}

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname;
  const method = req.method;
  const routes: Record<string, string[]> = {
    '/api/login': ['POST'], '/api/logout': ['POST'],
    '/api/board': ['GET', 'DELETE'], '/api/progress': ['POST', 'DELETE'],
  };
  if (!routes[path]) return reply(404, { error: 'No existe.' });
  if (!routes[path].includes(method)) return reply(405, { error: 'Método no permitido.' }, { Allow: routes[path].join(', ') });
  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
      return reply(403, { error: 'Origen no permitido.' });
    }
  }
  const password = Netlify.env.get('FACILITATOR_PASSWORD');
  if (!password) return reply(503, { error: 'El facilitador aún no está activado. Configura FACILITATOR_PASSWORD en Netlify y vuelve a publicar.' });
  const version = createHmac('sha256', password).update('facilitator-session-version').digest('hex');
  const cookie = /(?:^|;\s*)fac=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('cookie') || '');
  const cookieSettings = '; HttpOnly; Secure; SameSite=Strict; Path=/';

  try {
    const db = drizzle({ schema });
    const now = Date.now();
    if (path === '/api/logout') {
      if (cookie) await db.delete(schema.sessions).where(eq(schema.sessions.id, hash(cookie[1])));
      return reply(204, undefined, { 'Set-Cookie': 'fac=; Max-Age=0' + cookieSettings });
    }
    if (path === '/api/board') {
      if (!cookie) return reply(401, { error: 'No autorizado.' });
      const [session] = await db.select().from(schema.sessions).where(and(
        eq(schema.sessions.id, hash(cookie[1])), gt(schema.sessions.expires, now), eq(schema.sessions.version, version),
      ));
      if (!session) return reply(401, { error: 'La sesión ha caducado. Vuelve a entrar.' });
      if (method === 'DELETE') { await db.delete(schema.teams); return reply(204); }
      const teams = await db.select().from(schema.teams);
      return reply(200, { now, rows: teams.map(t => ({ ...t.data, updated: t.updated })) });
    }
    const body = await readBody(req);
    if (path === '/api/login') {
      const id = createHmac('sha256', password).update(context.ip || 'unknown').digest('hex');
      await db.delete(schema.attempts).where(lt(schema.attempts.reset, now));
      await db.delete(schema.sessions).where(lt(schema.sessions.expires, now));
      const [attempt] = await db.insert(schema.attempts).values({ id, count: 1, reset: now + 60000 })
        .onConflictDoUpdate({ target: schema.attempts.id, set: { count: sql`${schema.attempts.count} + 1` } }).returning();
      if (attempt.count > 10) return reply(429, { error: 'Demasiados intentos. Espera un minuto.' }, { 'Retry-After': '60' });
      if (typeof body.password !== 'string' || !timingSafeEqual(Buffer.from(hash(body.password), 'hex'), Buffer.from(hash(password), 'hex'))) {
        return reply(401, { error: 'Contraseña incorrecta.' });
      }
      const token = randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({ id: hash(token), expires: now + 43200000, version });
      return reply(200, { ok: true }, { 'Set-Cookie': 'fac=' + token + '; Max-Age=43200' + cookieSettings });
    }
    if (typeof body.pid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.pid)) return reply(400, { error: 'Equipo inválido.' });
    if (method === 'DELETE') {
      await db.delete(schema.teams).where(eq(schema.teams.pid, body.pid));
    } else {
      const record = { pid: body.pid, data: clean(body.data), updated: now };
      await db.insert(schema.teams).values(record).onConflictDoUpdate({ target: schema.teams.pid, set: { data: record.data, updated: now } });
    }
    return reply(204);
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === 'invalid')) return reply(400, { error: 'Solicitud inválida.' });
    if (error instanceof Error && error.message === 'large') return reply(413, { error: 'Solicitud demasiado grande.' });
    return reply(503, { error: 'No se pudo conectar con el tablero. Inténtalo de nuevo.' });
  }
};

export const config: Config = { path: '/api/*' };
