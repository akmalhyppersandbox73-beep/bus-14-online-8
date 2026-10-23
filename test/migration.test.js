'use strict';
// Uji HOST MIGRATION (Multiplayer LAN) pada protokol room dari index.html dengan Peer TIRUAN di memori.
// CATATAN: ini menguji logika protokol (pemilihan, serah-terima host, sinkron roster), BUKAN WebRTC/NAT sungguhan.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ALL = [];
afterEach(() => { ALL.splice(0).forEach(r => { try { r.leave(1); } catch (e) { /* sudah ditutup */ } }); });
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /const ICE=\{config[\s\S]*?(?=\nlet RM=null)/.exec(html);
assert.ok(m, 'blok mkRoom tidak ditemukan di index.html');

function world() {
  const NET = new Map();
  class Conn {
    constructor(owner, remote) { this.owner = owner; this.peer = remote; this.h = {}; this.open = false; }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
    cut() { return this.owner.frozen || (this.other && this.other.owner.frozen); }
    send(d) { if (!this.open) throw new Error('closed'); if (this.cut()) return; const o = this.other; const c = JSON.parse(JSON.stringify(d)); setImmediate(() => o.open && !this.cut() && o.emit('data', c)); }
    close() {
      if (!this.open) return; this.open = false;
      if (this.cut()) { setImmediate(() => this.emit('close')); return; }
      const o = this.other; o.open = false; setImmediate(() => { this.emit('close'); o.emit('close'); });
    }
  }
  class Peer {
    constructor(id, opts) {
      this.id = id || 'anon' + Math.random().toString(36).slice(2); this.h = {}; this.opts = opts; this.conns = []; this.frozen = false; this.disconnected = false; this.open = true;
      setImmediate(() => { if (NET.has(this.id)) { this.emit('error', { type: 'unavailable-id' }); return; } NET.set(this.id, this); this.emit('open', this.id); });
    }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
    connect(rid) {
      const c = new Conn(this, rid); this.conns.push(c);
      setImmediate(() => {
        const r = NET.get(rid); if (!r) { this.emit('error', { type: 'peer-unavailable' }); return; }
        if (this.frozen || r.frozen) return;
        const rc = new Conn(r, this.id); r.conns.push(rc); c.other = rc; rc.other = c; c.open = rc.open = true;
        r.emit('connection', rc); c.emit('open'); rc.emit('open');
      });
      return c;
    }
    reconnect() {}
    destroy() { if (NET.get(this.id) === this) NET.delete(this.id); this.conns.forEach(c => c.close()); }
  }
  const ctx = { Peer, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Math, Object, Array, String, Number, Map, Set, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nthis.mkRoom=mkRoom;', ctx);
  return { NET, mk: (...a) => ctx.mkRoom(...a).then(r => { ALL.push(r); return r; }), freeze: id => { NET.get(id).frozen = true; } };
}

const NETM = { prefix: 'b14l-', peer: {}, mig: 1 };   // LAN dengan migrasi
const NETO = { prefix: 'b14o-', peer: {} };           // ONLINE: tanpa migrasi
const FAST = { SILENT: 400, GRACE: 700, AWAY: 1500, WD: 50, RETRY: 200, HB: 100, ACK: 300, ELW: 600, LINKW: 500, ALIAS: 150 };
const initH = n => ({ name: n, hat: 0, sh: 0, pn: 0, rdy: 0, host: 1, g: 0, t0: 1, sn: 'Server Uji' });
const initC = (n, t) => ({ name: n, hat: 1, sh: 2, pn: 3, rdy: 0, host: 0, g: 0, t0: t });
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms));

// buat evaluator log per pemain
function evs(extra) {
  const e = { T: FAST, closes: [], states: [], migs: [], hosts: [], ups: 0, state: (s, i) => e.states.push(s), mig: (s, i) => e.migs.push([s, i]), host: i => e.hosts.push(i), close: w => e.closes.push(w), up: () => { e.ups++; }, can: () => 0 };
  return Object.assign(e, extra || {});
}
async function lobbyRoom(w, nGuests, opt) {
  opt = opt || {};
  const hev = evs(opt.hev), H = await w.mk('ABCD', true, initH('Host'), hev, 4, NETM), G = [];
  for (let i = 0; i < nGuests; i++) { const e = evs(opt.gev); G.push({ R: await w.mk('ABCD', false, initC('G' + i, 2 + i), e, undefined, NETM), e }); await tick(60); }
  await tick(500); // beri waktu tautan antar-guest terbentuk
  return { H, hev, G };
}
const hostsOf = G => G.filter(g => g.R.info().isHost);
const peersOf = g => g.R._cur.peers;

test('host keluar normal di LOBBY: semua guest tetap di room, tepat SATU host baru, roster sama di semua perangkat', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 3);
  assert.strictEqual(G[0].R._cur.peers.length, 4);
  H.leave();
  await tick(2500);
  G.forEach(g => assert.deepStrictEqual(g.e.closes, [], 'guest tidak boleh dikeluarkan'));
  const hs = hostsOf(G); assert.strictEqual(hs.length, 1, 'tepat satu host aktif');
  const hid = hs[0].R.info().myId;
  G.forEach(g => {
    const ps = peersOf(g); assert.strictEqual(ps.length, 3, 'tiga guest masih di room');
    assert.strictEqual(ps.filter(p => p.presence.host).length, 1);
    assert.strictEqual(ps.find(p => p.presence.host).peer, hid, 'semua sepakat siapa host');
    assert.ok(!ps.some(p => p.peer === 'b14l-abcd'), 'host lama tidak ada di roster');
    assert.ok(ps.every(p => !p.away), 'tidak ada yang berstatus menyambung ulang');
    assert.strictEqual(ps.find(p => p.presence.host).presence.sn, 'Server Uji', 'nama server diwariskan');
    assert.strictEqual(g.R.info().term, 1);
  });
  assert.strictEqual(hs[0].e.hosts.length, 1, 'callback host baru terpanggil sekali');
  G.filter(g => !g.R.info().isHost).forEach(g => assert.ok(g.e.migs.some(x => x[0] === 'done' && x[1].host === hid), 'notifikasi migrasi selesai'));
  G.filter(g => !g.R.info().isHost).forEach(g => assert.ok(g.e.states.includes('elect'), 'UI diberi tahu pemilihan berlangsung'));
});

test('Room ID asli diambil alih host baru: pemain baru bisa bergabung dengan kode yang sama di lobi', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 2);
  H.leave(); await tick(2500);
  assert.ok(w.NET.has('b14l-abcd'), 'ID asli diklaim ulang');
  const N = await w.mk('ABCD', false, initC('Baru', 9), evs(), undefined, NETM); await tick(600);
  const host = hostsOf(G)[0];
  assert.strictEqual(host.R._cur.peers.length, 3);
  assert.ok(N._cur.peers.length >= 3);
});

test('host koneksi putus MENDADAK saat gameplay: game lanjut, posisi pemain & status dipertahankan', async () => {
  let started = false; const can = () => (started ? 'started' : 0);
  const w = world(); const { G } = await lobbyRoom(w, 3, { hev: { can }, gev: { can } });
  started = true; // game dimulai: pemain baru ditolak
  for (let i = 0; i < 3; i++) await G[i].R.presence({ g: 1, x: 10 + i, z: -5 - i, r: 1, sc: 'b' });
  await tick(300);
  w.freeze('b14l-abcd');
  await tick(5000);
  G.forEach(g => assert.deepStrictEqual(g.e.closes, []));
  const hs = hostsOf(G); assert.strictEqual(hs.length, 1);
  G.forEach(g => {
    const ps = peersOf(g); assert.strictEqual(ps.length, 3);
    ps.forEach(p => { assert.strictEqual(p.presence.g, 1); assert.strictEqual(p.presence.sc, 'b'); });
    G.forEach((g2, i) => { const p = ps.find(q => q.peer === g2.R.info().myId); assert.strictEqual(p.presence.x, 10 + i, 'posisi dipertahankan'); assert.strictEqual(p.presence.z, -5 - i); });
  });
});

test('relay pesan & presence berjalan normal lewat host baru', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 3);
  H.leave(); await tick(2500);
  const got = [];
  G.forEach((g, i) => g.R.on('b14', d => got.push([i, d.data || d])));
  const host = hostsOf(G)[0], guest = G.find(g => !g.R.info().isHost);
  await guest.R.emit('b14', { t: 'chat', m: 'halo' }); await tick(300);
  assert.ok(got.length >= 3, 'chat sampai ke semua (termasuk pengirim via host)');
  await guest.R.presence({ x: 42, z: 7 }); await tick(400);
  const gp = host.R._cur.peers.find(p => p.peer === guest.R.info().myId);
  assert.strictEqual(gp.presence.x, 42, 'presence guest sampai ke host baru');
});

test('calon host terpilih langsung putus saat migrasi: pemilihan diulang, pemain terputus tidak terpilih', async () => {
  const w = world();
  let forced = null;
  const { G } = await lobbyRoom(w, 3, { gev: { pick: m => (forced && m.includes(forced) ? forced : m[0]) } });
  forced = G[1].R.info().myId;
  G[1].e.host = () => { w.freeze(forced); }; // terpilih lalu langsung mati sebelum ada yang tersambung
  w.freeze('b14l-abcd');
  await tick(9000);
  const alive = [G[0], G[2]]; const hs = hostsOf(alive);
  assert.strictEqual(hs.length, 1, 'tepat satu host di antara pemain yang hidup');
  alive.forEach(g => { assert.deepStrictEqual(g.e.closes, []); const ps = peersOf(g); assert.ok(!ps.some(p => p.peer === forced), 'yang mati dikeluarkan dari roster'); assert.strictEqual(ps.filter(p => p.presence.host).length, 1); assert.ok(g.R.info().term >= 2, 'term naik karena pemilihan diulang'); });
});

test('guest ber-ID terkecil (koordinator) ikut mati bersama host: guest lain tetap memilih host', async () => {
  const w = world(); const { G } = await lobbyRoom(w, 3);
  const ids = G.map(g => g.R.info().myId).sort(); const dead = G.find(g => g.R.info().myId === ids[0]);
  w.freeze('b14l-abcd'); w.freeze(ids[0]);
  await tick(9000);
  const alive = G.filter(g => g !== dead);
  assert.strictEqual(hostsOf(alive).length, 1);
  alive.forEach(g => { assert.deepStrictEqual(g.e.closes, []); assert.ok(!peersOf(g).some(p => p.peer === ids[0])); });
});

test('hanya satu guest tersisa: ia langsung menjadi host dan room tidak ditutup', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 1);
  H.leave(); await tick(2500);
  assert.strictEqual(G[0].R.info().isHost, true); assert.deepStrictEqual(G[0].e.closes, []);
  assert.strictEqual(peersOf(G[0]).length, 1);
});

test('host baru keluar lagi: pemilihan diulang ke guest yang tersisa (berantai), tetap satu host', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 3);
  H.leave(); await tick(2500);
  const h2 = hostsOf(G)[0]; h2.R.leave(); await tick(2500);
  const rest = G.filter(g => g !== h2); const hs = hostsOf(rest);
  assert.strictEqual(hs.length, 1); rest.forEach(g => { assert.deepStrictEqual(g.e.closes, []); assert.strictEqual(peersOf(g).length, 2); assert.strictEqual(g.R.info().term, 2); });
});

test('guest biasa yang keluar tidak memicu migrasi (host tetap host)', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 2);
  G[0].R.leave(); await tick(1500);
  assert.strictEqual(H.info().isHost, true); assert.strictEqual(H.info().term, 0);
  assert.strictEqual(G[1].R.info().isHost, false); assert.deepStrictEqual(G[1].e.closes, []);
  assert.strictEqual(H._cur.peers.length, 2);
});

test('hasil pemilihan acak: semua guest berpeluang terpilih (bukan selalu yang sama)', async () => {
  const seen = new Set();
  for (let i = 0; i < 14 && seen.size < 3; i++) {
    const w = world(); const { H, G } = await lobbyRoom(w, 3);
    const order = G.map(g => g.R.info().myId).sort();
    H.leave(); await tick(1800);
    const hs = hostsOf(G); assert.strictEqual(hs.length, 1);
    seen.add(order.indexOf(hs[0].R.info().myId));
    ALL.splice(0).forEach(r => { try { r.leave(1); } catch (e) {} });
  }
  assert.ok(seen.size >= 2, 'pemenang bervariasi: ' + [...seen]);
});

test('guest yang masih melihat host hidup menolak pemilihan (tidak ada dua host)', async () => {
  const w = world(); const { H, G } = await lobbyRoom(w, 2);
  // guest 0 terisolasi dari host saja: paksa dengan menutup koneksinya ke host; host & guest 1 tetap sehat
  const c = w.NET.get(G[0].R.info().myId).conns.find(x => x.peer === 'b14l-abcd');
  assert.ok(c); c.open = false; // klien merasa koneksi mati, host tidak tahu
  await tick(3000);
  assert.strictEqual(H.info().isHost, true);
  assert.strictEqual(G[1].R.info().isHost, false, 'guest sehat tidak ikut memilih host baru');
});

test('ONLINE tidak berubah: host keluar = sesi berakhir untuk guest (tanpa migrasi)', async () => {
  const w = world(); const e1 = evs(), e2 = evs();
  const H = await w.mk('ABCD', true, initH('Host'), evs(), 4, NETO);
  const A = await w.mk('ABCD', false, initC('A', 2), e1, undefined, NETO);
  const B = await w.mk('ABCD', false, initC('B', 3), e2, undefined, NETO);
  await tick(400); H.leave(); await tick(800);
  assert.deepStrictEqual(e1.closes, ['bye']); assert.deepStrictEqual(e2.closes, ['bye']);
  assert.strictEqual(A.info().isHost, false); assert.strictEqual(B.info().isHost, false);
});

test('ONLINE: host mati mendadak = timeout seperti semula, tidak ada pemilihan', async () => {
  const w = world(); const e1 = evs();
  const H = await w.mk('ABCD', true, initH('Host'), evs(), 4, NETO);
  const A = await w.mk('ABCD', false, initC('A', 2), e1, undefined, NETO);
  await tick(300); w.freeze('b14o-abcd'); await tick(2500);
  assert.deepStrictEqual(e1.closes, ['timeout']); assert.strictEqual(A.info().isHost, false);
});
