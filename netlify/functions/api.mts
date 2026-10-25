// API del juego (equivalente a las rutas /api/* de server.js) para Netlify.
import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const MAX_TEAMS = 300
const MAX_BODY = 8 * 1024
const SESSION_MS = 12 * 3600 * 1000
const SUS_IDS = ['valeria', 'mateo', 'camila', 'julian', 'sofia']

/* ---------- Validación de lo que envían los jugadores ---------- */
function int(v: unknown, min: number, max: number) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min }
function tsOrNull(v: unknown) { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 4e12 ? n : null }
function clean(d: any) {
  d = d && typeof d === 'object' ? d : {}
  const closed = d.status === 'solved' || d.status === 'gaveup'
  const opened = Array.isArray(d.opened) ? [...new Set<number>(d.opened.map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 8))].sort((a, b) => a - b) : []
  return {
    team: String(d.team || '').slice(0, 40),
    status: closed ? d.status : 'playing',
    start: tsOrNull(d.start),
    end: closed ? tsOrNull(d.end) : null,
    timeMs: closed ? int(d.timeMs, 0, 1e9) : null,
    clues: opened.length,
    opened,
    out: Array.isArray(d.out) ? [...new Set(d.out.filter((x: unknown) => SUS_IDS.includes(x as string)))] : [],
    hints: int(d.hints, 0, 2),
    wrong: int(d.wrong, 0, 99),
    pts: closed ? int(d.pts, 0, 100) : null,
    culprit: SUS_IDS.includes(d.culprit) ? d.culprit : '',
    motiveOk: closed && typeof d.motiveOk === 'boolean' ? d.motiveOk : null,
    methodOk: closed && typeof d.methodOk === 'boolean' ? d.methodOk : null
  }
}
const validPid = (p: unknown): p is string => typeof p === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(p)

/* ---------- Sesión del facilitador (token firmado, sin estado) ---------- */
const sha = (s: string) => createHash('sha256').update(s).digest()
const password = () => process.env.FACILITATOR_PASSWORD || ''
const sign = (exp: string) => createHmac('sha256', 'fac:' + password()).update(exp).digest('hex')
function isFacilitator(req: Request) {
  if (!password()) return false
  const m = /(?:^|;\s*)fac=(\d+)\.([a-f0-9]{64})/.exec(req.headers.get('cookie') || '')
  if (!m || Number(m[1]) < Date.now()) return false
  return timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(sign(m[1]), 'hex'))
}
const attempts = new Map<string, { n: number, reset: number }>() // mejor esfuerzo, por instancia

/* ---------- Utilidades HTTP ---------- */
function send(code: number, body?: unknown, headers?: Record<string, string>) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers)
  if (code === 204 || body === undefined) return new Response(null, { status: code, headers: h })
  return Response.json(body, { status: code, headers: h })
}
async function readJson(req: Request) {
  const text = await req.text()
  if (text.length > MAX_BODY) throw Object.assign(new Error('grande'), { code: 413 })
  try { return JSON.parse(text || '{}') } catch (e) { throw Object.assign(new Error('json'), { code: 400 }) }
}

export default async (req: Request, context: { ip?: string }) => {
  try {
    const p = new URL(req.url).pathname.replace(/\/+$/, '')
    const db = getDatabase()

    if (p === '/api/progress' && req.method === 'POST') {
      const b = await readJson(req)
      if (!validPid(b.pid)) return send(400, { error: 'pid' })
      const [{ n }] = await db.sql`SELECT COUNT(*)::int AS n FROM teams WHERE pid <> ${b.pid}`
      if (n >= MAX_TEAMS) {
        const [exists] = await db.sql`SELECT 1 FROM teams WHERE pid = ${b.pid}`
        if (!exists) return send(429, { error: 'lleno' })
      }
      const data = JSON.stringify(clean(b.data))
      await db.sql`INSERT INTO teams (pid, data, updated) VALUES (${b.pid}, ${data}::jsonb, ${Date.now()})
        ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data, updated = EXCLUDED.updated`
      return send(204)
    }
    if (p === '/api/progress' && req.method === 'DELETE') {
      const b = await readJson(req)
      if (validPid(b.pid)) await db.sql`DELETE FROM teams WHERE pid = ${b.pid}`
      return send(204)
    }
    if (p === '/api/login' && req.method === 'POST') {
      if (!password()) return send(503, { error: 'Falta configurar la contraseña del facilitador (variable FACILITATOR_PASSWORD) en Netlify.' })
      const ip = context.ip || '?', now = Date.now()
      const a = attempts.get(ip) || { n: 0, reset: now + 60000 }
      if (now > a.reset) { a.n = 0; a.reset = now + 60000 }
      if (a.n >= 10) return send(429, { error: 'Demasiados intentos. Esperen un minuto.' })
      a.n++; attempts.set(ip, a)
      const b = await readJson(req)
      if (!timingSafeEqual(sha(String(b.password || '')), sha(password()))) return send(401, { error: 'Contraseña incorrecta.' })
      const exp = String(now + SESSION_MS)
      return send(200, { ok: true }, { 'Set-Cookie': 'fac=' + exp + '.' + sign(exp) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; Secure' })
    }
    if (p === '/api/logout' && req.method === 'POST') {
      return send(204, undefined, { 'Set-Cookie': 'fac=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure' })
    }
    if (p === '/api/board') {
      if (!isFacilitator(req)) return send(401, { error: 'No autorizado' })
      if (req.method === 'GET') {
        const rows = await db.sql`SELECT data, updated FROM teams`
        return send(200, { now: Date.now(), rows: rows.map((t: any) => Object.assign({ updated: Number(t.updated) }, t.data)) })
      }
      if (req.method === 'DELETE') { await db.sql`DELETE FROM teams`; return send(204) }
    }
    return send(404, { error: 'No existe' })
  } catch (e: any) {
    if (e && (e.code === 413 || e.code === 400)) return send(e.code, { error: 'Solicitud inválida' })
    console.error(e)
    return send(500, { error: 'Error del servidor' })
  }
}

export const config: Config = { path: '/api/*' }
