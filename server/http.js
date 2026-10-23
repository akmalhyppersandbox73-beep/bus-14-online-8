'use strict';
// Handler HTTP murni Node (tanpa dependensi) untuk /health dan /api/rooms.
// Dipasang ke Express lewat app.use(handler) dan juga bisa diuji langsung dengan http.createServer.
const { RoomError } = require('./rooms');

const MAX_BODY = 2048;

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new RoomError(413, 'too_large', 'Payload terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const o = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(o && typeof o === 'object' ? o : {});
      } catch (e) { reject(new RoomError(400, 'bad_json', 'JSON tidak valid.')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || '';
}

function createHandler(registry, opts = {}) {
  const allowed = (opts.allowedOrigins || ['*']).map(s => String(s).trim()).filter(Boolean);
  const startedAt = Date.now();

  function cors(req, res) {
    const origin = req.headers.origin;
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  return async function handler(req, res, next) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const isApi = p === '/health' || p === '/api/rooms' || p.startsWith('/api/rooms/');
    if (!isApi) return next && next();
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    try {
      if (p === '/health' && req.method === 'GET') {
        return send(res, 200, {
          ok: true, app: 'bus14-server', version: opts.version || '1.0.0',
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          rooms: registry.publicSize ? registry.publicSize() : registry.size(), time: Date.now(),
        });
      }
      if (p === '/api/rooms' && req.method === 'GET') {
        const mode = url.searchParams.get('mode') || undefined;
        if (mode && !['online', 'lan'].includes(mode)) throw new RoomError(400, 'bad_mode', 'Mode tidak valid.');
        return send(res, 200, { rooms: registry.list(mode), now: Date.now() });
      }
      if (p === '/api/rooms' && req.method === 'POST') {
        const b = await readBody(req);
        const r = registry.create(b, clientIp(req));
        return send(res, 201, { id: r.id, token: r.token, hidden: r.hidden, ttlMs: registry.ttlMs, heartbeatMs: Math.round(registry.ttlMs / 3) });
      }
      const m = /^\/api\/rooms\/([A-Za-z]{4})(\/close)?$/.exec(p);
      if (m) {
        const id = m[1].toUpperCase();
        // sendBeacon hanya bisa POST -> /close
        if (m[2] && req.method === 'POST') {
          const b = await readBody(req);
          registry.remove(id, b.mode === 'lan' ? 'lan' : 'online', b.token);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT') {
          const b = await readBody(req);
          const r = registry.heartbeat(id, b.mode === 'lan' ? 'lan' : 'online', b.token, b);
          return send(res, 200, { ok: true, players: r.players, status: r.status, hidden: r.hidden });
        }
        if (req.method === 'DELETE') {
          const b = await readBody(req);
          registry.remove(id, b.mode === 'lan' ? 'lan' : 'online', b.token);
          return send(res, 200, { ok: true });
        }
      }
      throw new RoomError(404, 'not_found', 'Endpoint tidak ditemukan.');
    } catch (e) {
      if (e instanceof RoomError) return send(res, e.status, { error: e.message, code: e.code });
      console.error('[http] error:', e && e.message);
      return send(res, 500, { error: 'Kesalahan server.', code: 'internal' });
    }
  };
}

module.exports = { createHandler };
