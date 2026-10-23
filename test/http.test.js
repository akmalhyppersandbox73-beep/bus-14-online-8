'use strict';
// Uji HTTP nyata: server http sungguhan di port acak, dua "klien" (host & pemain) memakai fetch terpisah.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Registry } = require('../server/rooms');
const { createHandler } = require('../server/http');

async function start(opts = {}) {
  const reg = new Registry(opts.reg);
  const h = createHandler(reg, { allowedOrigins: opts.origins || ['*'] });
  const srv = http.createServer((q, s) => h(q, s, () => { s.statusCode = 404; s.end('{}'); }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return { reg, srv, base, close: () => new Promise(r => srv.close(r)) };
}
const J = (base, p, method = 'GET', body, headers = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));

test('GET /health', async () => {
  const s = await start();
  const r = await J(s.base, '/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.app, 'bus14-server');
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
  await s.close();
});

test('alur lengkap: buat room -> muncul di daftar -> heartbeat -> penuh -> host keluar', async () => {
  const s = await start();
  const c = await J(s.base, '/api/rooms', 'POST', { id: 'ABCD', name: 'Server Uji', hostName: 'Host', max: 2, mode: 'online' });
  assert.strictEqual(c.status, 201);
  assert.ok(c.body.token && c.body.token.length === 32);
  // klien kedua (koneksi terpisah) melihat daftar
  let l = await J(s.base, '/api/rooms?mode=online');
  assert.strictEqual(l.body.rooms.length, 1);
  assert.strictEqual(l.body.rooms[0].name, 'Server Uji');
  assert.strictEqual(l.body.rooms[0].players, 1);
  // pemain bergabung -> host heartbeat 2 pemain -> penuh
  const hb = await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: c.body.token, players: 2, status: 'LOBBY' });
  assert.strictEqual(hb.status, 200);
  l = await J(s.base, '/api/rooms?mode=online');
  assert.strictEqual(l.body.rooms[0].full, true);
  // game mulai
  await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: c.body.token, players: 2, status: 'BERMAIN' });
  l = await J(s.base, '/api/rooms?mode=online');
  assert.strictEqual(l.body.rooms[0].status, 'BERMAIN');
  // token salah ditolak
  const bad = await J(s.base, '/api/rooms/ABCD', 'DELETE', { mode: 'online', token: 'x'.repeat(32) });
  assert.strictEqual(bad.status, 403);
  // host keluar lewat beacon (POST text/plain /close)
  const cl = await fetch(s.base + '/api/rooms/ABCD/close', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: c.body.token, mode: 'online' }) });
  assert.strictEqual(cl.status, 200);
  l = await J(s.base, '/api/rooms?mode=online');
  assert.strictEqual(l.body.rooms.length, 0);
  await s.close();
});

test('daftar LAN dan ONLINE terpisah', async () => {
  const s = await start();
  await J(s.base, '/api/rooms', 'POST', { id: 'AAAA', mode: 'online' });
  await J(s.base, '/api/rooms', 'POST', { id: 'AAAA', mode: 'lan' });
  assert.strictEqual((await J(s.base, '/api/rooms?mode=lan')).body.rooms.length, 1);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 1);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=zzz')).status, 400);
  await s.close();
});

test('input tidak valid: JSON rusak, body terlalu besar, id salah, endpoint tak dikenal, CORS preflight', async () => {
  const s = await start();
  const bj = await fetch(s.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rusak' });
  assert.strictEqual(bj.status, 400);
  const big = await fetch(s.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'ABCD', name: 'x'.repeat(5000) }) }).catch(() => ({ status: 'reset' }));
  assert.ok(big.status === 413 || big.status === 'reset');
  assert.strictEqual((await J(s.base, '/api/rooms', 'POST', { id: '12' })).status, 400);
  assert.strictEqual((await J(s.base, '/api/rooms/ZZZZ', 'PUT', { token: 'a' })).status, 404);
  assert.strictEqual((await J(s.base, '/api/tidakada')).status, 404);
  const pre = await fetch(s.base + '/api/rooms', { method: 'OPTIONS', headers: { Origin: 'https://x.itch.zone', 'Access-Control-Request-Method': 'POST' } });
  assert.strictEqual(pre.status, 204);
  assert.ok(pre.headers.get('access-control-allow-methods').includes('PUT'));
  await s.close();
});

test('ALLOWED_ORIGINS membatasi origin', async () => {
  const s = await start({ origins: ['https://game.example'] });
  const ok = await J(s.base, '/health', 'GET', null, { Origin: 'https://game.example' });
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://game.example');
  const no = await J(s.base, '/health', 'GET', null, { Origin: 'https://evil.example' });
  assert.strictEqual(no.headers.get('access-control-allow-origin'), null);
  await s.close();
});

test('room tanpa heartbeat hilang dari daftar setelah TTL', async () => {
  const s = await start({ reg: { ttlMs: 150 } });
  await J(s.base, '/api/rooms', 'POST', { id: 'ABCD' });
  assert.strictEqual((await J(s.base, '/api/rooms')).body.rooms.length, 1);
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual((await J(s.base, '/api/rooms')).body.rooms.length, 0);
  await s.close();
});
