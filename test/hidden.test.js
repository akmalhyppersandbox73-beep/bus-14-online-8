'use strict';
// Uji fitur "Sembunyikan Room dari List Server": registry, HTTP sungguhan, dan kode klien (index.html) terhadap server nyata.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Registry } = require('../server/rooms');
const { createHandler } = require('../server/http');

async function start(opts = {}) {
  const reg = new Registry(opts.reg);
  const h = createHandler(reg, {});
  const srv = http.createServer((q, s) => h(q, s, () => { s.statusCode = 404; s.end('{}'); }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return { reg, srv, base, close: () => new Promise(r => srv.close(r)) };
}
const J = (base, p, method = 'GET', body) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('registry: room tersembunyi tidak ada di list, tetap tersimpan; default publik', () => {
  const r = new Registry();
  r.create({ id: 'PUBL' });
  const h = r.create({ id: 'HIDE', hidden: true });
  assert.strictEqual(h.hidden, true);
  assert.deepStrictEqual(r.list('online').map(x => x.id), ['PUBL']);
  assert.deepStrictEqual(r.list().map(x => x.id), ['PUBL']);
  assert.strictEqual(r.size(), 2);
  assert.strictEqual(r.publicSize(), 1);
  assert.throws(() => r.create({ id: 'HIDE' }), { code: 'id_taken' }, 'ID room tersembunyi tetap terpakai');
  assert.throws(() => r.create({ id: 'XXXX', hidden: 'ya' }), { code: 'bad_hidden' });
});

test('registry: ubah status saat berjalan, token wajib, nilai tak valid ditolak', () => {
  const r = new Registry();
  const a = r.create({ id: 'ABCD', max: 4 });
  r.heartbeat('ABCD', 'online', a.token, { players: 3, status: 'BERMAIN', hidden: true });
  assert.strictEqual(r.list().length, 0);
  assert.throws(() => r.heartbeat('ABCD', 'online', 'salah', { hidden: false }), { code: 'bad_token' });
  assert.strictEqual(r.list().length, 0, 'token salah tidak boleh membuka room');
  assert.throws(() => r.heartbeat('ABCD', 'online', a.token, { hidden: 'false' }), { code: 'bad_hidden' });
  // heartbeat tanpa field hidden TIDAK mengubah status
  r.heartbeat('ABCD', 'online', a.token, { players: 2 });
  assert.strictEqual(r.list().length, 0);
  r.heartbeat('ABCD', 'online', a.token, { hidden: false });
  const x = r.list();
  assert.deepStrictEqual([x.length, x[0].players, x[0].status], [1, 2, 'BERMAIN']);
});

test('registry: room tersembunyi tetap kedaluwarsa & dibersihkan seperti biasa', () => {
  let t = 1000;
  const r = new Registry({ ttlMs: 20000, now: () => t });
  r.create({ id: 'HIDE', hidden: true });
  t += 30000;
  r.sweep();
  assert.strictEqual(r.size(), 0);
});

test('HTTP: POST hidden -> tidak muncul di GET; cari/filter tidak menemukan; /health tidak membocorkan jumlah', async () => {
  const s = await start();
  const c = await J(s.base, '/api/rooms', 'POST', { id: 'ABCD', name: 'Rahasia', hostName: 'Host', mode: 'online', hidden: true });
  assert.strictEqual(c.status, 201);
  assert.strictEqual(c.body.hidden, true);
  await J(s.base, '/api/rooms', 'POST', { id: 'WXYZ', name: 'Publik', hostName: 'Host', mode: 'online' });
  const l = await J(s.base, '/api/rooms?mode=online');
  assert.deepStrictEqual(l.body.rooms.map(r => r.id), ['WXYZ']);
  assert.ok(!JSON.stringify(l.body).includes('Rahasia') && !JSON.stringify(l.body).includes('ABCD'));
  assert.strictEqual((await J(s.base, '/health')).body.rooms, 1);
  assert.strictEqual((await J(s.base, '/api/rooms/ABCD')).status, 404, 'tidak ada endpoint lookup per-ID');
  const bad = await J(s.base, '/api/rooms', 'POST', { id: 'QQQQ', hidden: 'true' });
  assert.strictEqual(bad.status, 400);
  await s.close();
});

test('HTTP: toggle saat room berjalan (LOBBY -> BERMAIN) tanpa menghapus room; token salah ditolak', async () => {
  const s = await start();
  const c = await J(s.base, '/api/rooms', 'POST', { id: 'ABCD', name: 'Uji', mode: 'online' });
  const tok = c.body.token;
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 1);
  let r = await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: tok, players: 2, status: 'BERMAIN', hidden: true });
  assert.deepStrictEqual([r.status, r.body.hidden], [200, true]);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 0);
  assert.strictEqual((await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: 'x'.repeat(32), hidden: false })).status, 403);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 0);
  r = await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: tok, players: 2, status: 'BERMAIN', hidden: false });
  const l = await J(s.base, '/api/rooms?mode=online');
  assert.deepStrictEqual([l.body.rooms.length, l.body.rooms[0].players, l.body.rooms[0].status], [1, 2, 'BERMAIN']);
  assert.strictEqual((await J(s.base, '/api/rooms/ABCD', 'PUT', { mode: 'online', token: tok, hidden: 'x' })).status, 400);
  await s.close();
});

// ---- kode klien nyata dari index.html, dijalankan terhadap server HTTP nyata ----
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('index.html: elemen UI & alur pengiriman hidden ada', () => {
  for (const id of ['ohd', 'mhd', 'phd', 'mhk', 'phk']) assert.ok(html.includes('id="' + id + '"'), 'elemen ' + id);
  assert.ok(html.includes('Sembunyikan Room dari List Server'));
  assert.ok(html.includes("mpJoin(CODE(),1,OMX,'online',n,$('ohd').checked)"));
});

function clientWorld(base) {
  const m = /\/\/ --- registry client[\s\S]*?(?=addEventListener\('pagehide')/.exec(html);
  const h = /\/\/ --- sembunyikan room[\s\S]*?(?=addEventListener\('pagehide')/.exec(html);
  assert.ok(m && h, 'blok registry/toggle klien tidak ditemukan'); assert.ok(m[0].includes('async function setHidden'));
  const els = {};
  const el = id => els[id] || (els[id] = { id, checked: false, disabled: false, textContent: '', classList: { s: new Set(['hid']), toggle(c, f) { f ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } } });
  const ctx = {
    $: el, S: { host: 1, mp: 0, peers: [{}, {}] }, C: { name: 'Host' }, performance, setInterval, clearInterval, setTimeout, clearTimeout, console,
    fj: (url, ms, opt) => fetch(url, opt).then(async r => { const j = await r.json().catch(() => null); if (!r.ok) throw { type: 'http', status: r.status, msg: j && j.error }; return j; }),
    errMsg: e => (e && e.msg) || 'error',
    navigator: {}, fetch,
  };
  vm.createContext(ctx);
  // api() sama seperti di index.html
  vm.runInContext("const api=(b,p,o)=>fj(b+p,8000,o&&o.body?Object.assign({headers:{'Content-Type':'application/json'}},o):o);", ctx);
  vm.runInContext(m[0].replace(/^\/\/.*$/m, '') , ctx);
  vm.runInContext('globalThis.__x={regStart,regStop,setHidden,hidUI,getREG:()=>REG,setS:v=>{S.host=v}};', ctx);
  return { x: ctx.__x, els, ctx };
}

test('klien nyata: host membuat room tersembunyi, toggle on/off saat berjalan, guest tetap bisa lihat/ikut sesuai status', async () => {
  const s = await start();
  const { x, els } = clientWorld(s.base + '/api');
  const api = s.base + '/api';
  await x.regStart({ api }, 'online', 'HIDE', 'Server Uji', 4, true);
  const REG = () => x.getREG();
  assert.strictEqual(REG().hidden, true);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 0, 'sejak registrasi pertama sudah tersembunyi');
  assert.strictEqual(s.reg.rooms.size, 1, 'room tetap terdaftar di server (bukan dihapus)');
  x.hidUI();
  assert.strictEqual(els.mhk.classList.contains('hid'), false, 'toggle host tampil di lobi');
  assert.strictEqual(els.phk.classList.contains('hid'), false, 'toggle host tampil di menu jeda');
  assert.strictEqual(els.mhd.checked, true);
  // host menonaktifkan saat room sedang BERMAIN
  await new Promise(r => setTimeout(r, 0));
  await x.setHidden(false);
  let l = await J(s.base, '/api/rooms?mode=online');
  assert.deepStrictEqual(l.body.rooms.map(r => r.id), ['HIDE']);
  assert.strictEqual(els.mhd.checked, false);
  assert.strictEqual(els.mhd.disabled, false);
  // aktifkan lagi
  await x.setHidden(true);
  assert.strictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.length, 0);
  assert.strictEqual(REG().hidden, true);
  // room dihapus server (mis. restart) -> toggle mendaftar ulang dengan status baru, tidak gagal
  s.reg.rooms.clear();
  await x.setHidden(false);
  assert.deepStrictEqual((await J(s.base, '/api/rooms?mode=online')).body.rooms.map(r => r.id), ['HIDE']);
  // server mati -> status kembali ke nilai lama, pesan galat tampil, tidak melempar
  await s.close();
  await x.setHidden(true);
  assert.strictEqual(x.getREG().hidden, false, 'status lokal tidak berubah bila server gagal');
  assert.strictEqual(els.mhd.checked, false);
  assert.ok(/Gagal/.test(els.mhs.textContent));
  x.regStop();
});

test('klien nyata: LAN/guest tidak menampilkan toggle', async () => {
  const s = await start();
  const { x, els } = clientWorld(s.base + '/api');
  await x.regStart({ api: s.base + '/api' }, 'lan', 'LANN', 'LAN Uji', 4, false);
  x.hidUI();
  assert.strictEqual(els.mhk.classList.contains('hid'), true);
  x.regStop();
  await x.regStart({ api: s.base + '/api' }, 'online', 'ONLN', 'Online', 4, false);
  x.setS(0); // guest
  x.hidUI();
  assert.strictEqual(els.mhk.classList.contains('hid'), true);
  x.regStop();
  await s.close();
});
