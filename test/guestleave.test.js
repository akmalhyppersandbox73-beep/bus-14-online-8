'use strict';
// Uji fitur "guest ONLINE keluar sendiri": protokol room (Peer tiruan), logika UI (DOM tiruan), pembersihan suara voting, dan registry.
// CATATAN: protokol diuji di memori (bukan WebRTC/NAT sungguhan).
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Registry } = require('../server/rooms');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// pakai harness Peer tiruan yang sama dengan p2p.test.js
const p2p = fs.readFileSync(path.join(__dirname, 'p2p.test.js'), 'utf8');
const wsrc = /function world\(\) \{[\s\S]*?\n\}\n(?=const NETC)/.exec(p2p);
assert.ok(wsrc, 'harness world() tidak ditemukan');
const m = /const ICE=\{config[\s\S]*?(?=\nlet RM=null)/.exec(html);
assert.ok(m, 'blok mkRoom tidak ditemukan');
const ALL = [];
afterEach(() => { ALL.splice(0).forEach(r => { try { r.leave(1); } catch (e) { /* sudah ditutup */ } }); });
const world = new Function('vm', 'm', 'ALL', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', wsrc[0] + '\nreturn world;')(vm, m, ALL, setImmediate, setTimeout, clearTimeout, setInterval, clearInterval);

const NETC = { prefix: 'b14o-', peer: { host: 'x', port: 443, secure: true, path: '/peerjs' } };
const initH = n => ({ name: n, hat: 0, sh: 0, pn: 0, rdy: 0, host: 1, g: 0, t0: 1, sn: 'Server Uji' });
const initC = (n, t) => ({ name: n, hat: 1, sh: 2, pn: 3, rdy: 0, host: 0, g: 0, t0: t });
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms));
const names = r => r._cur.peers.map(p => p.presence.name).sort().join(',');

async function trio(w, evB = {}, evH = {}) {
  const H = await w.mkRoom('ABCD', true, initH('Host'), evH, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), evB, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick();
  assert.strictEqual(H._cur.peers.length, 3);
  return { H, A, B };
}

test('A. host + 2 guest: guest pertama keluar sendiri -> host & guest kedua tetap terhubung, daftar 2 pemain di semua sisi', async () => {
  const w = world(); const closed = [];
  const { H, A, B } = await trio(w, {}, { close: () => closed.push('H') });
  B.leave();
  await tick(300);
  assert.strictEqual(H._cur.peers.length, 2);
  assert.strictEqual(names(H), 'Ana,Host');
  assert.strictEqual(names(A), 'Ana,Host');
  assert.ok(H._cur.peers.every(p => !p.away), 'tidak ada ghost (AWAY)');
  assert.deepStrictEqual(closed, [], 'host tidak ikut keluar');
  assert.ok(w.NET.has('b14o-abcd'), 'peer host (room) tetap hidup');
  assert.ok(!w.NET.has(B.info().myId), 'peer guest yang keluar sudah dihancurkan');
  // pesan masih mengalir antara host dan guest yang tersisa
  const got = []; H.on('b14', e => got.push(e)); A.emit('b14', { t: 'chat', m: 'halo' });
  await tick();
  assert.strictEqual(got.length, 1);
  A.presence({ rdy: 1 }); await tick();
  assert.strictEqual(H._cur.peers.find(p => p.presence.name == 'Ana').presence.rdy, 1);
  H.leave(); A.leave();
});

test('guest keluar tidak memicu event close di guest lain; guest yang keluar tidak menerima event room lagi', async () => {
  const w = world(); let closedA = 0, gotB = 0;
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), { close: () => closedA++ }, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  B.on('b14', () => gotB++); await tick();
  B.leave(); await tick(300);
  const before = gotB;
  H.emit('b14', { t: 'chat', m: 'x' }); A.emit('b14', { t: 'chat', m: 'y' }); await tick();
  assert.strictEqual(gotB, before, 'tidak ada event yang masuk ke guest yang sudah keluar');
  assert.strictEqual(closedA, 0);
  H.leave(); A.leave();
});

test('B. guest keluar saat game berjalan: host & guest lain lanjut, daftar tetap konsisten', async () => {
  const w = world(); let started = false;
  const H = await w.mkRoom('ABCD', true, initH('Host'), { can: () => (started ? 'started' : 0) }, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick(); started = true;
  H.presence({ g: 1 }); A.presence({ g: 1 }); B.presence({ g: 1 }); await tick();
  assert.strictEqual(H._cur.peers.filter(p => p.presence.g).length, 3);
  B.leave(); await tick(300);
  assert.strictEqual(H._cur.peers.filter(p => p.presence.g).length, 2, 'jumlah pemain aktif turun jadi 2');
  assert.strictEqual(A._cur.peers.length, 2);
  const got = []; A.on('b14', e => got.push(e.data)); H.emit('b14', { t: 'do', k: 'travel' }); await tick();
  assert.deepStrictEqual(got, [{ t: 'do', k: 'travel' }], 'game tetap berjalan untuk guest tersisa');
  H.leave(); A.leave();
});

test('C. guest yang sudah keluar bisa bergabung lagi selama room masih tersedia (di lobi)', async () => {
  const w = world();
  const { H, A, B } = await trio(w);
  B.leave(); await tick(300);
  assert.strictEqual(H._cur.peers.length, 2);
  const B2 = await w.mkRoom('ABCD', false, initC('Budi', 9), {}, undefined, NETC);
  await tick();
  assert.strictEqual(H._cur.peers.length, 3);
  assert.strictEqual(names(B2), 'Ana,Budi,Host');
  assert.strictEqual(names(A), 'Ana,Budi,Host');
  H.leave(); A.leave(); B2.leave();
});

test('D. host tetap bisa mengelola room: kick guest tersisa & terima guest baru setelah guest lain keluar', async () => {
  const w = world(); let kicked = '';
  const { H, A, B } = await trio(w, { close: why => { kicked = why; } });
  B.leave(); await tick(300);
  const aid = H._cur.peers.find(p => p.presence.name == 'Ana').peer;
  assert.strictEqual(H.kick(aid), true);
  await tick(900);
  assert.strictEqual(kicked, 'kick');
  assert.strictEqual(H._cur.peers.length, 1);
  const C = await w.mkRoom('ABCD', false, initC('Cici', 5), {}, undefined, NETC);
  await tick();
  assert.strictEqual(H._cur.peers.length, 2);
  H.leave(); C.leave();
});

test('keamanan: guest tidak bisa mengeluarkan pemain lain; keluar hanya berlaku untuk dirinya sendiri', async () => {
  const w = world();
  const { H, A, B } = await trio(w);
  const hid = H.info().myId, bid = B.info().myId;
  assert.strictEqual(A.kick(bid), false, 'R.kick hanya berlaku di host');
  assert.strictEqual(A.kick(hid), false);
  await tick();
  assert.strictEqual(H._cur.peers.length, 3);
  A.leave(); await tick(300);
  assert.strictEqual(H._cur.peers.map(p => p.peer).sort().join(), [hid, bid].sort().join(), 'hanya pengirim yang dihapus');
  H.leave(); B.leave();
});

test('keluar saat koneksi ke host bermasalah tidak melempar error dan sesi lokal dibersihkan', async () => {
  const w = world();
  const { H, A, B } = await trio(w);
  w.freeze(B.info().myId);
  assert.doesNotThrow(() => B.leave());
  assert.doesNotThrow(() => B.leave(), 'leave dua kali aman');
  assert.doesNotThrow(() => B.emit('b14', { t: 'chat', m: 'x' }));
  H.leave(); A.leave();
});

// ---------- UI (blok HOSTGUARD) dengan DOM tiruan
const blk = /\/\/ <<HOSTGUARD([\s\S]*?)\/\/ HOSTGUARD>>/.exec(html);
assert.ok(blk, 'blok HOSTGUARD tidak ditemukan');
function ui(net, mp, host) {
  const els = {}, calls = [], timers = [];
  const mkEl = () => { const c = new Set(['hid']); return { classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x), toggle: (x, f) => (f ? c.add(x) : c.delete(x)) }, textContent: '', disabled: false, onclick: null }; };
  const $ = id => els[id] || (els[id] = mkEl());
  const ctx = {
    $, S: { mp, host, mode: 'bus' }, RM: {}, lastNet: net, calls, Date, Math, Set, console,
    toMenu: () => { calls.push('toMenu'); $('menu').classList.remove('hid'); }, mpLeave: () => calls.push('mpLeave'), mpBack: x => calls.push(['mpBack', x]),
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(blk[1] + '\nthis.guestLocked=guestLocked;this.leaveAsk=leaveAsk;this.guestLeave=guestLeave;', ctx);
  return { ctx, $, calls, hidden: id => $(id).classList.contains('hid') };
}

test('UI ONLINE guest saat game: tombol keluar aktif, konfirmasi dulu, BATAL tidak keluar', () => {
  const e = ui('online', 1, 0);
  assert.strictEqual(e.ctx.guestLocked(), false);
  e.ctx.syncExit();
  assert.strictEqual(e.$('bm').disabled, false);
  assert.match(e.$('bm').textContent, /KELUAR DARI ROOM/);
  e.ctx.leaveReq();
  assert.strictEqual(e.hidden('lc'), false, 'dialog konfirmasi tampil');
  assert.ok(!e.calls.includes('toMenu'));
  e.$('lcn').onclick();
  assert.strictEqual(e.hidden('lc'), true);
  assert.deepStrictEqual(e.calls, []);
});

test('UI ONLINE guest: YA -> keluar & kembali ke menu Multiplayer Online (saat game dan di lobi)', () => {
  let e = ui('online', 1, 0); e.ctx.leaveReq(); e.$('lcy').onclick();
  assert.ok(e.calls.includes('toMenu'));
  assert.strictEqual(e.hidden('menu'), true, 'menu utama tidak menimpa layar online');
  assert.ok(e.calls.some(c => Array.isArray(c) && /keluar dari room/i.test(c[1])));
  assert.strictEqual(e.hidden('lc'), true);
  e = ui('online', 0, 0); e.ctx.leaveAsk(); assert.strictEqual(e.hidden('lc'), false); e.$('lcy').onclick();
  assert.ok(e.calls.includes('mpLeave') && !e.calls.includes('toMenu'));
  assert.ok(e.calls.some(c => Array.isArray(c)));
});

test('UI LAN guest: sama seperti online (tombol aktif, konfirmasi, keluar ke layar LAN); host tidak memakai dialog guest', () => {
  let e = ui('lan', 1, 0); e.ctx.syncExit();
  assert.strictEqual(e.ctx.guestLocked(), false);
  assert.match(e.$('bm').textContent, /KELUAR DARI ROOM/);
  e.ctx.leaveReq(); assert.strictEqual(e.hidden('lc'), false); assert.ok(!e.calls.includes('toMenu'));
  e.$('lcy').onclick();
  assert.ok(e.calls.includes('toMenu') && e.calls.some(c => Array.isArray(c)));
  e = ui('online', 1, 1); e.ctx.syncExit();
  assert.strictEqual(e.$('bm').textContent, 'AKHIRI SESI');
  e.ctx.leaveAsk(); assert.strictEqual(e.hidden('lc'), true, 'host tidak memakai dialog guest');
  e.ctx.guestLeave(); assert.deepStrictEqual(e.calls, []);
  e = ui('lan', 1, 1); e.ctx.syncExit(); assert.match(e.$('bm').textContent, /HOST PINDAH/, 'host LAN tidak berubah');
});

test('LAN (host migration aktif): guest keluar sendiri -> tidak ada pemilihan host, host & guest lain tetap, tidak ada ghost', async () => {
  const w = world(); const states = []; let closed = 0;
  const NL = { prefix: 'b14l-', mig: true, peer: {} };
  const FAST = { SILENT: 400, GRACE: 700, AWAY: 900, WD: 50, RETRY: 200, HB: 100 };
  const ev = { T: FAST, close: () => closed++, state: s => states.push(s) };
  const H = await w.mkRoom('ABCD', true, initH('Host'), ev, 4, NL);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), ev, undefined, NL);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), ev, undefined, NL);
  await tick(400);
  assert.strictEqual(H._cur.peers.length, 3);
  B.leave(); await tick(1500);
  assert.strictEqual(H._cur.peers.length, 2);
  assert.strictEqual(names(A), 'Ana,Host');
  assert.ok(H._cur.peers.every(p => !p.away));
  assert.deepStrictEqual([...states], [], 'tidak ada pemilihan/sambung-ulang');
  assert.strictEqual(closed, 0);
  assert.strictEqual(H.info().isHost, true);
  assert.strictEqual(A.info().hostId, H.info().myId);
  H.leave(); A.leave();
});

// ---------- voting: suara pemain yang keluar dibuang agar game tidak macet / salah hitung
test('voting: guest yang sudah memilih lalu keluar -> suaranya dibuang, voting selesai bila sisa pemain sudah memilih', () => {
  const sn = /if\(S\.host&&V\)\{let ch=0;[\s\S]*?vend\(\)\}(?=const live)/.exec(html);
  assert.ok(sn, 'blok prune voting tidak ditemukan');
  const sent = []; let ended = 0;
  const ctx = { S: { host: 1 }, V: { v: { h: 1, a: 0, b: 1 }, end: 1e12 }, performance: { now: () => 0 }, vsend: () => sent.push(Object.keys(ctx.V.v).length), vend: () => { ended++; ctx.V = null; }, gp: () => [{ peer: 'h' }, { peer: 'a' }] };
  vm.createContext(ctx);
  vm.runInContext(sn[0], ctx);
  assert.deepStrictEqual(sent, [2], 'suara b dibuang & tampilan diperbarui');
  assert.strictEqual(ended, 1, 'sisa pemain (h, a) sudah memilih -> selesai');
  const ctx2 = { S: { host: 1 }, V: { v: { h: 1 }, end: 1e12 }, performance: { now: () => 0 }, vsend: () => {}, vend: () => { ctx2.V = null; }, gp: () => [{ peer: 'h' }, { peer: 'a' }] };
  vm.createContext(ctx2); vm.runInContext(sn[0], ctx2);
  assert.ok(ctx2.V, 'masih menunggu pemain yang belum memilih');
});

// ---------- registry: room & jumlah pemain tetap akurat
test('registry: guest keluar -> jumlah pemain turun, room tetap terdaftar & terbuka (tidak dihapus)', () => {
  const reg = new Registry({ ttlMs: 20000 });
  const r = reg.create({ id: 'ABCD', mode: 'online', max: 4, hostName: 'Host' }, '1.1.1.1');
  reg.heartbeat('ABCD', 'online', r.token, { players: 3, status: 'LOBBY' });
  assert.strictEqual(reg.list('online')[0].players, 3);
  reg.heartbeat('ABCD', 'online', r.token, { players: 2, status: 'LOBBY' });
  const l = reg.list('online');
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].players, 2);
  assert.strictEqual(l[0].full, false);
  assert.throws(() => reg.heartbeat('ABCD', 'online', 'token-salah', { players: 1 }), { code: 'bad_token' }, 'hanya host yang bisa mengubah registry');
});
