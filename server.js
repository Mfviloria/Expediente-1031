'use strict';
// Servidor sin dependencias externas (solo Node 18+).
//   /              -> juego (jugadores)
//   /facilitador   -> panel del facilitador (requiere contraseña)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
let PASSWORD = process.env.FACILITATOR_PASSWORD || '';
const generated = !PASSWORD;
if (generated) PASSWORD = crypto.randomBytes(4).toString('hex');

const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.json');
const MAX_TEAMS = 300;
const MAX_BODY = 8 * 1024;
const SUS_IDS = ['valeria', 'mateo', 'camila', 'julian', 'sofia'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

/* ---------- Estado y persistencia ---------- */
const teams = new Map(); // pid -> { data, updated }
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [pid, rec] of Object.entries(raw)) if (/^[A-Za-z0-9_-]{8,64}$/.test(pid)) teams.set(pid, rec);
} catch (e) { /* primer arranque */ }

let persistTimer = null;
function persist(now) {
  clearTimeout(persistTimer);
  const run = () => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(teams)));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('No se pudo guardar el tablero:', e.message); }
  };
  if (now) run(); else persistTimer = setTimeout(run, 500);
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => { persist(true); process.exit(0); }));

/* ---------- Validación de lo que envían los jugadores ---------- */
function int(v, min, max) { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function tsOrNull(v) { v = Number(v); return Number.isFinite(v) && v > 0 && v < 4e12 ? v : null; }
function clean(d) {
  d = d && typeof d === 'object' ? d : {};
  const closed = d.status === 'solved' || d.status === 'gaveup';
  const opened = Array.isArray(d.opened) ? [...new Set(d.opened.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8))].sort((a, b) => a - b) : [];
  return {
    team: String(d.team || '').slice(0, 40),
    status: closed ? d.status : 'playing',
    start: tsOrNull(d.start),
    end: closed ? tsOrNull(d.end) : null,
    timeMs: closed ? int(d.timeMs, 0, 1e9) : null,
    clues: opened.length,
    opened,
    out: Array.isArray(d.out) ? [...new Set(d.out.filter((x) => SUS_IDS.includes(x)))] : [],
    hints: int(d.hints, 0, 2),
    wrong: int(d.wrong, 0, 99),
    pts: closed ? int(d.pts, 0, 100) : null,
    culprit: SUS_IDS.includes(d.culprit) ? d.culprit : '',
    motiveOk: closed && typeof d.motiveOk === 'boolean' ? d.motiveOk : null,
    methodOk: closed && typeof d.methodOk === 'boolean' ? d.methodOk : null
  };
}

/* ---------- Sesión del facilitador ---------- */
const sessions = new Map(); // token -> expira
const attempts = new Map(); // ip -> { n, reset }
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function samePassword(input) { return crypto.timingSafeEqual(sha(input), sha(PASSWORD)); }
function ipOf(req) {
  const xf = TRUST_PROXY && req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : req.socket.remoteAddress) || '?';
}
function isFacilitator(req) {
  const m = /(?:^|;\s*)fac=([a-f0-9]{48})/.exec(req.headers.cookie || '');
  const exp = m && sessions.get(m[1]);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}

/* ---------- Utilidades HTTP ---------- */
function send(res, code, body, headers) {
  const isObj = body !== null && typeof body === 'object';
  res.writeHead(code, Object.assign({ 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(code === 204 ? undefined : (isObj ? JSON.stringify(body) : body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', (c) => { size += c.length; if (tooBig) return; if (size > MAX_BODY) { tooBig = true; reject(Object.assign(new Error('grande'), { code: 413 })); } else chunks.push(c); });
    req.on('end', () => { if (tooBig) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(e, { code: 400 })); } });
    req.on('error', reject);
  });
}
const validPid = (p) => typeof p === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(p);

async function api(req, res, p) {
  if (p === '/api/progress' && req.method === 'POST') {
    const b = await readJson(req);
    if (!validPid(b.pid)) return send(res, 400, { error: 'pid' });
    if (!teams.has(b.pid) && teams.size >= MAX_TEAMS) return send(res, 429, { error: 'lleno' });
    teams.set(b.pid, { data: clean(b.data), updated: Date.now() });
    persist();
    return send(res, 204);
  }
  if (p === '/api/progress' && req.method === 'DELETE') {
    const b = await readJson(req);
    if (validPid(b.pid) && teams.delete(b.pid)) persist();
    return send(res, 204);
  }
  if (p === '/api/login' && req.method === 'POST') {
    const ip = ipOf(req), now = Date.now();
    const a = attempts.get(ip) || { n: 0, reset: now + 60000 };
    if (now > a.reset) { a.n = 0; a.reset = now + 60000; }
    if (a.n >= 10) return send(res, 429, { error: 'Demasiados intentos. Esperen un minuto.' });
    a.n++; attempts.set(ip, a);
    const b = await readJson(req);
    if (!samePassword(b.password || '')) return send(res, 401, { error: 'Contraseña incorrecta.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, now + 12 * 3600 * 1000);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'fac=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + secure });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    const m = /fac=([a-f0-9]{48})/.exec(req.headers.cookie || '');
    if (m) sessions.delete(m[1]);
    return send(res, 204, null, { 'Set-Cookie': 'fac=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/board') {
    if (!isFacilitator(req)) return send(res, 401, { error: 'No autorizado' });
    if (req.method === 'GET') return send(res, 200, { now: Date.now(), rows: [...teams.values()].map((t) => Object.assign({ updated: t.updated }, t.data)) });
    if (req.method === 'DELETE') { teams.clear(); persist(true); return send(res, 204); }
  }
  return send(res, 404, { error: 'No existe' });
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    const rel = p === '/' ? '/index.html' : (p === '/facilitador' ? '/facilitador.html' : decodeURIComponent(p));
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith('.')) return send(res, 404, 'No encontrado');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'No encontrado');
      const h = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
      if (rel === '/facilitador.html') h['X-Robots-Tag'] = 'noindex';
      res.writeHead(200, h);
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 ? 413 : 400, { error: 'Solicitud inválida' }, { Connection: 'close' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('Juego (jugadores):   http://localhost:' + PORT + '/');
  console.log('Panel facilitador:   http://localhost:' + PORT + '/facilitador');
  if (generated) console.log('Contraseña del facilitador (temporal, cambia en cada arranque): ' + PASSWORD + '\n  Para fijarla: FACILITATOR_PASSWORD=tu_clave node server.js');
});
