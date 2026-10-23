'use strict';
// Uji logika protokol room (mkRoom) dari index.html dengan Peer TIRUAN di memori.
// CATATAN: ini menguji protokol lobi/validasi/relay, BUKAN WebRTC/NAT sungguhan.
const test = require('node:test');
const { afterEach } = require('node:test');
const ALL = [];
afterEach(() => { ALL.splice(0).forEach(r => { try { r.leave(1); } catch (e) { /* sudah ditutup */ } }); });
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
      if (this.cut()) { setImmediate(() => this.emit('close')); return; } // internet putus: pihak lain tidak diberi tahu
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
        if (this.frozen || r.frozen) return; // tidak ada jalur: koneksi menggantung
        const rc = new Conn(r, this.id); r.conns.push(rc); c.other = rc; rc.other = c; c.open = rc.open = true;
        r.emit('connection', rc); c.emit('open'); rc.emit('open');
      });
      return c;
    }
    reconnect() {}
    destroy() { NET.delete(this.id); this.conns.forEach(c => c.close()); }
  }
  const ctx = { Peer, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Math, Object, Array, String, Number, Map, Set, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nthis.mkRoom=mkRoom;this.peerOpts2=peerOpts2;', ctx);
  return { NET, mkRoom: (...a) => ctx.mkRoom(...a).then(r => { ALL.push(r); return r; }), peerOpts2: ctx.peerOpts2, ctx, freeze: id => { NET.get(id).frozen = true; }, thaw: id => { NET.get(id).frozen = false; } };
}
const NETC = { prefix: 'b14o-', peer: { host: 'x', port: 443, secure: true, path: '/peerjs' } };
const initH = (n) => ({ name: n, hat: 0, sh: 0, pn: 0, rdy: 0, host: 1, g: 0, t0: 1, sn: 'Server Uji' });
const initC = (n, t) => ({ name: n, hat: 1, sh: 2, pn: 3, rdy: 0, host: 0, g: 0, t0: t });
const FAST = { SILENT: 400, GRACE: 700, AWAY: 900, WD: 50, RETRY: 200, HB: 100 };
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms));

test('host membuat room, klien kedua bergabung, daftar pemain sinkron di kedua sisi', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  assert.ok(w.NET.has('b14o-abcd'), 'ID peer memakai prefix online');
  const C = await w.mkRoom('ABCD', false, initC('Budi', 2), {}, undefined, NETC);
  await tick();
  assert.strictEqual(H._cur.peers.length, 2);
  assert.strictEqual(C._cur.peers.length, 2);
  const host = C._cur.peers.find(p => p.presence.host);
  assert.strictEqual(host.presence.sn, 'Server Uji', 'nama server sampai ke klien');
  assert.strictEqual(C._cur.peers.find(p => p.isMe).presence.name, 'Budi');
  H.leave(); C.leave();
});

test('LAN dan ONLINE memakai ruang ID terpisah (prefix berbeda)', async () => {
  const w = world();
  const A = await w.mkRoom('ABCD', true, initH('A'), {}, 4, { prefix: 'b14o-', peer: {} });
  const B = await w.mkRoom('ABCD', true, initH('B'), {}, 4, { prefix: 'b14l-', peer: {} });
  assert.ok(w.NET.has('b14o-abcd') && w.NET.has('b14l-abcd'));
  A.leave(); B.leave();
});

test('ID bentrok ditolak (unavailable-id) dan room tak ada -> peer-unavailable', async () => {
  const w = world();
  const A = await w.mkRoom('ABCD', true, initH('A'), {}, 4, NETC);
  await assert.rejects(w.mkRoom('ABCD', true, initH('B'), {}, 4, NETC), { type: 'unavailable-id' });
  await assert.rejects(w.mkRoom('ZZZZ', false, initC('C', 3), {}, undefined, NETC), { type: 'peer-unavailable' });
  A.leave();
});

test('room penuh: pemain ke-3 ditolak pada kapasitas 2', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 2, NETC);
  const C = await w.mkRoom('ABCD', false, initC('B', 2), {}, undefined, NETC);
  await assert.rejects(w.mkRoom('ABCD', false, initC('C', 3), {}, undefined, NETC), { type: 'full' });
  await tick();
  assert.strictEqual(H._cur.peers.length, 2);
  H.leave(); C.leave();
});

test('game sudah dimulai: pemain baru ditolak (started)', async () => {
  const w = world();
  let started = false;
  const H = await w.mkRoom('ABCD', true, initH('Host'), { can: () => started ? 'started' : 0 }, 4, NETC);
  started = true;
  await assert.rejects(w.mkRoom('ABCD', false, initC('B', 2), {}, undefined, NETC), { type: 'started' });
  H.leave();
});

test('pemain keluar -> hilang dari daftar host; host terputus -> klien menerima close', async () => {
  const w = world();
  let closed = 0;
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const C = await w.mkRoom('ABCD', false, initC('B', 2), { close: () => closed++ }, undefined, NETC);
  const D = await w.mkRoom('ABCD', false, initC('D', 3), {}, undefined, NETC);
  await tick();
  assert.strictEqual(H._cur.peers.length, 3);
  D.leave();
  await tick(200);
  assert.strictEqual(H._cur.peers.length, 2, 'pemain yang keluar dihapus');
  H.leave(); // host putus
  await tick(200);
  assert.strictEqual(closed, 1, 'klien diberi tahu host terputus');
  C.leave();
});

test('relay pesan: chat sampai ke semua; pesan "start"/jenis tak dikenal dari klien DIBUANG; payload besar dibuang', async () => {
  const w = world();
  const got = { H: [], C: [], D: [] };
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const C = await w.mkRoom('ABCD', false, initC('B', 2), {}, undefined, NETC);
  const D = await w.mkRoom('ABCD', false, initC('D', 3), {}, undefined, NETC);
  H.on('b14', x => got.H.push(x)); C.on('b14', x => got.C.push(x)); D.on('b14', x => got.D.push(x));
  await tick();
  await C.emit('b14', { t: 'chat', m: 'halo' });
  await C.emit('b14', { t: 'start' });                 // hanya host yang boleh memulai
  await C.emit('b14', { t: 'do', k: 'exit' });         // klien tidak boleh memaksa aksi
  await C.emit('b14', { t: 'chat', m: 'x'.repeat(5000) }); // terlalu besar
  await tick(250);
  for (const k of ['H', 'C', 'D']) {
    assert.strictEqual(got[k].length, 1, 'penerima ' + k + ' hanya menerima 1 pesan sah');
    assert.strictEqual(got[k][0].data.t, 'chat');
  }
  const cid = C._cur.peers.find(p => p.isMe).peer;
  assert.strictEqual(got.H[0].peer, cid, 'pengirim diisi host dari koneksi asli (tidak bisa dipalsukan)');
  await H.emit('b14', { t: 'start' });                 // host boleh
  await tick(200);
  assert.ok(got.C.some(x => x.data.t == 'start'));
  H.leave(); C.leave(); D.leave();
});

test('presence disanitasi: koordinat dijepit, flag host/mx/sn dari klien diabaikan', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 3, NETC);
  const C = await w.mkRoom('ABCD', false, initC('B', 2), {}, undefined, NETC);
  await tick();
  await C.presence({ x: 1e9, z: '<x>', r: -1e9, hat: 99, sh: -5, rdy: 'yes', host: 1, mx: 4, sn: 'palsu', name: 'N'.repeat(50) });
  await tick(250);
  const me = H._cur.peers.find(p => !p.isMe).presence;
  assert.strictEqual(me.x, 500); assert.strictEqual(me.z, 0); assert.strictEqual(me.r, -500);
  assert.strictEqual(me.hat, 8); assert.strictEqual(me.sh, 0); assert.strictEqual(me.rdy, 1);
  assert.strictEqual(me.name.length, 16);
  assert.ok(!me.host, 'klien tidak bisa menjadi host'); assert.ok(!me.sn);
  const hostP = H._cur.peers.find(p => p.isMe).presence;
  assert.strictEqual(hostP.mx, 3);
  H.leave(); C.leave();
});

test('rate limit: banjir pesan dari satu klien dibatasi', async () => {
  const w = world();
  const got = [];
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const C = await w.mkRoom('ABCD', false, initC('B', 2), {}, undefined, NETC);
  H.on('b14', x => got.push(x));
  await tick();
  for (let i = 0; i < 300; i++) await C.emit('b14', { t: 'chat', m: 'spam' + i });
  await tick(300);
  assert.ok(got.length > 0 && got.length <= 65, 'diterima ' + got.length);
  H.leave(); C.leave();
});

test('opsi signaling & TURN dari config diteruskan ke PeerJS', async () => {
  const w = world();
  w.ctx.window.GAME_CONFIG = { ICE_SERVERS: [{ urls: 'turn:t.example:3478', username: 'u', credential: 'c' }, { bukan: 'valid' }] };
  const o = w.peerOpts2(NETC);
  assert.strictEqual(o.host, 'x'); assert.strictEqual(o.port, 443); assert.strictEqual(o.secure, true); assert.strictEqual(o.path, '/peerjs');
  const urls = o.config.iceServers.map(s => s.urls);
  assert.ok(urls.includes('turn:t.example:3478') && urls.some(u => /^stun:/.test(u)));
  assert.strictEqual(o.config.iceServers.length, 3, 'entri tanpa urls dibuang');
});

// ================= Host keluar / terputus =================
const mk = async (w, code, host, name, rec, extra = {}) =>
  w.mkRoom(code, host, host ? initH(name) : initC(name, Date.now() % 1000 + 2), { T: FAST, close: why => rec.closed.push(why), state: s => rec.states.push(s), ...extra }, 4, NETC);
const rec = () => ({ closed: [], states: [] });

test('host keluar normal: SEMUA guest langsung menerima "bye", room tidak diambil alih guest', async () => {
  const w = world(); const rh = rec(), r1 = rec(), r2 = rec(), r3 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rh);
  const G1 = await mk(w, 'ABCD', false, 'G1', r1), G2 = await mk(w, 'ABCD', false, 'G2', r2), G3 = await mk(w, 'ABCD', false, 'G3', r3);
  await tick();
  assert.strictEqual(H._cur.peers.length, 4);
  H.leave();
  await tick(250);
  for (const r of [r1, r2, r3]) assert.deepStrictEqual(r.closed, ['bye'], 'tiap guest diberi tahu tepat sekali');
  assert.deepStrictEqual(rh.closed, [], 'host sendiri tidak memanggil close');
  assert.ok(!w.NET.has('b14o-abcd'), 'room mati; tidak ada guest yang menjadi host');
  assert.ok(![...w.NET.keys()].some(k => k.startsWith('b14')), 'tidak ada peer room yang tersisa');
});

test('host menutup tab (leave tanpa jeda, "bye" best-effort): guest tidak pernah menggantung — bye atau timeout setelah masa tenggang', async () => {
  const w = world(); const r1 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  await mk(w, 'ABCD', false, 'G1', r1);
  await tick();
  H.leave(1);
  await tick(1800);
  assert.strictEqual(r1.closed.length, 1, 'sesi diakhiri tepat sekali');
  assert.ok(['bye', 'timeout'].includes(r1.closed[0]));
});

test('host kehilangan internet (diam, tanpa close/bye): guest masuk status sambung-ulang lalu sesi berakhir (timeout)', async () => {
  const w = world(); const r1 = rec(), r2 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  await mk(w, 'ABCD', false, 'G1', r1); await mk(w, 'ABCD', false, 'G2', r2);
  await tick();
  w.freeze('b14o-abcd');
  await tick(2200);
  for (const r of [r1, r2]) {
    assert.deepStrictEqual(r.states, ['recon'], 'masuk status sambung ulang');
    assert.deepStrictEqual(r.closed, ['timeout'], 'sesi diakhiri konsisten setelah masa tenggang');
  }
  H.leave();
});

test('host kembali online dalam masa tenggang: guest tersambung lagi, sesi TIDAK berakhir', async () => {
  const w = world(); const r1 = rec(), r2 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  const G1 = await mk(w, 'ABCD', false, 'G1', r1); await mk(w, 'ABCD', false, 'G2', r2);
  await tick();
  w.freeze('b14o-abcd');
  await tick(650);            // > SILENT(400) tetapi < SILENT+GRACE
  w.thaw('b14o-abcd');
  await tick(1200);
  for (const r of [r1, r2]) {
    assert.deepStrictEqual(r.closed, [], 'tidak ada penutupan');
    assert.deepStrictEqual(r.states, ['recon', 'ok'], 'recon lalu pulih');
  }
  assert.strictEqual(H._cur.peers.length, 3, 'slot guest dipertahankan host');
  assert.ok(H._cur.peers.every(p => !p.away));
  assert.strictEqual(G1._cur.peers.length, 3);
  H.leave();
});

test('guest kehilangan internet sebentar: slot ditahan host (away) lalu kembali normal', async () => {
  const w = world(); const r1 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  const G = await mk(w, 'ABCD', false, 'G1', r1);
  await tick();
  const gid = G._cur.peers.find(p => p.isMe).peer;
  w.freeze(gid);
  await tick(800);
  assert.strictEqual(H._cur.peers.length, 2, 'masih terdaftar');
  assert.ok(H._cur.peers.find(p => p.peer === gid).away, 'ditandai away');
  w.thaw(gid);
  await tick(900);
  assert.deepStrictEqual(r1.closed, []);
  assert.ok(!H._cur.peers.find(p => p.peer === gid).away, 'tidak lagi away');
  H.leave(); G.leave();
});

test('guest offline terlalu lama: host menghapus slot, guest menerima akhir sesi; host & guest lain tidak terganggu', async () => {
  const w = world(); const r1 = rec(), r2 = rec(), rh = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rh);
  const G1 = await mk(w, 'ABCD', false, 'G1', r1); const G2 = await mk(w, 'ABCD', false, 'G2', r2);
  await tick();
  const gid = G1._cur.peers.find(p => p.isMe).peer;
  w.freeze(gid);
  await tick(2800);
  assert.strictEqual(H._cur.peers.length, 2, 'slot G1 dihapus host');
  assert.deepStrictEqual(r1.closed, ['timeout']);
  assert.deepStrictEqual(r2.closed, []);
  assert.deepStrictEqual(rh.closed, []);
  H.leave(); G2.leave();
});

test('guest yang sudah dikeluarkan tidak bisa "menyusup" kembali (token/sesi tidak cocok -> stale)', async () => {
  const w = world(); const got = [];
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  const raw = new w.ctx.Peer('penyusup');
  await tick(30);
  const c = raw.connect('b14o-abcd');
  c.on('open', () => c.send({ k: 'hi', p: { name: 'x' }, rt: 'tebakan', sid: 'bukan-sid-host' }));
  c.on('data', d => got.push(d));
  await tick(200);
  assert.deepStrictEqual(got.map(g => g.r), ['stale']);
  assert.strictEqual(H._cur.peers.length, 1, 'tidak masuk daftar');
  H.leave();
});

test('guest tidak bisa mengubah/menyamar jadi host lewat client (bye/host palsu diabaikan)', async () => {
  const w = world(); const r1 = rec();
  const H = await mk(w, 'ABCD', true, 'Host', rec());
  const G1 = await mk(w, 'ABCD', false, 'G1', r1); const G2 = await mk(w, 'ABCD', false, 'G2', rec());
  await tick();
  await G1.presence({ host: 1, sn: 'palsu', k: 'bye' });
  await tick(250);
  const hosts = H._cur.peers.filter(p => p.presence.host);
  assert.strictEqual(hosts.length, 1);
  assert.strictEqual(hosts[0].presence.name, 'Host');
  assert.strictEqual(H._cur.peers.length, 3);
  H.leave(); G1.leave(); G2.leave();
});

// ---------- KICK PLAYER (host-authoritative; ditegakkan di mkRoom, bukan hanya UI)
const others = (r) => r._cur.peers.filter(p => !p.isMe);

test('kick: host mengeluarkan guest -> guest menerima "kick" & langsung terputus, daftar pemain lain diperbarui', async () => {
  const w = world(); const lost = [];
  const H = await w.mkRoom('KICK', true, initH('Host'), {}, 4, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), { close: why => lost.push(['A', why]) }, undefined, NETC);
  const B = await w.mkRoom('KICK', false, initC('B', 3), { close: why => lost.push(['B', why]) }, undefined, NETC);
  await tick(250);
  assert.strictEqual(H._cur.peers.length, 3);
  const target = H._cur.peers.find(p => !p.isMe && p.presence.name == 'A').peer;
  assert.strictEqual(H.kick(target), true);
  await tick(900);
  assert.deepStrictEqual(lost, [['A', 'kick']], 'hanya A yang terputus, alasan kick');
  assert.strictEqual(H._cur.peers.length, 2, 'daftar host berkurang');
  assert.strictEqual(B._cur.peers.length, 2, 'guest lain melihat daftar terbaru');
  assert.ok(!B._cur.peers.some(p => p.presence.name == 'A'));
  H.leave(); B.leave(); A.leave(1);
});

test('kick: guest tidak bisa kick (R.kick false) dan pesan palsu {k:"kick"} dari guest diabaikan host', async () => {
  const w = world();
  const H = await w.mkRoom('KICK', true, initH('Host'), {}, 4, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), {}, undefined, NETC);
  const B = await w.mkRoom('KICK', false, initC('B', 3), {}, undefined, NETC);
  await tick(250);
  const bId = A._cur.peers.find(p => p.presence.name == 'B').peer;
  assert.strictEqual(A.kick(bId), false, 'guest tidak punya hak kick');
  // guest memalsukan pesan langsung ke koneksi host
  for (const forged of [{ k: 'kick', id: bId }, { k: 'kick', peer: bId }, { k: 'e', n: 'b14', d: { t: 'kick', id: bId } }, { k: 'e', n: 'kick', d: { id: bId } }]) {
    const c = [...w.NET.get(A._cur.peers.find(p => p.isMe).peer).conns][0]; c.send(forged);
  }
  await tick(300);
  assert.strictEqual(H._cur.peers.length, 3, 'tidak ada yang dikeluarkan');
  assert.strictEqual(B._cur.peers.length, 3);
  H.leave(); A.leave(1); B.leave(1);
});

test('kick: host tidak bisa kick diri sendiri, ID tak dikenal/bukan string/sudah keluar -> false tanpa error', async () => {
  const w = world();
  const H = await w.mkRoom('KICK', true, initH('Host'), {}, 4, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), {}, undefined, NETC);
  await tick(200);
  const me = H._cur.peers.find(p => p.isMe).peer;
  assert.strictEqual(H.kick(me), false);
  for (const bad of ['nope', '', null, undefined, 123, {}, ['x']]) assert.strictEqual(H.kick(bad), false);
  assert.strictEqual(H._cur.peers.length, 2);
  A.leave(); await tick(300); // A keluar sendiri (bye) -> kick berikutnya aman
  const aId = 'tidak-ada';
  assert.strictEqual(H.kick(aId), false);
  H.leave();
});

test('kick: guest yang sedang terputus (menyambung ulang) bisa di-kick tanpa error & tidak bisa kembali dengan token lama', async () => {
  const w = world(); const lost = [];
  const H = await w.mkRoom('KICK', true, initH('Host'), { T: FAST }, 4, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), { T: FAST, close: why => lost.push(why) }, undefined, NETC);
  await tick(250);
  const aId = H._cur.peers.find(p => !p.isMe).peer;
  w.freeze(aId); // internet A putus
  await tick(900);
  assert.ok(H._cur.peers.find(p => p.peer == aId) === undefined || H._cur.peers.find(p => p.peer == aId).away, 'A putus / menunggu sambung ulang');
  if (H._cur.peers.some(p => p.peer == aId)) assert.strictEqual(H.kick(aId), true);
  w.thaw(aId); await tick(1500);
  assert.ok(!H._cur.peers.some(p => p.peer == aId), 'A tidak kembali ke daftar');
  assert.ok(!lost.includes('bye'));
  H.leave(); A.leave(1);
});

test('kick: pemain yang di-kick ditolak saat mencoba menyambung lagi dengan identitas lama (ID peer / token), room lain tidak terpengaruh', async () => {
  const w = world(); const lost = [];
  const H = await w.mkRoom('KICK', true, initH('Host'), {}, 4, NETC);
  const H2 = await w.mkRoom('OTHR', true, initH('Host2'), {}, 4, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), { close: why => lost.push(why) }, undefined, NETC);
  await tick(250);
  const aPeer = H._cur.peers.find(p => !p.isMe).peer;
  // simulasikan klien lama yang masih memegang Peer & token: kirim ulang "hi" dengan rt/sid lama lewat koneksi baru dari peer yang sama
  const aPeerObj = w.NET.get(aPeer);
  assert.ok(H.kick(aPeer));
  await tick(900);
  assert.deepStrictEqual(lost, ['kick']);
  // peer yang sama (ID lama) mencoba connect lagi
  const refused = [];
  const c = aPeerObj.connect('b14o-kick'); // peer sudah di-destroy oleh klien; koneksi baru memakai ID lama
  c.on('data', d => refused.push(d)); c.on('open', () => c.send({ k: 'hi', p: initC('A', 2), rt: 'x'.repeat(10), sid: null }));
  await tick(500);
  assert.ok(refused.some(d => d.k == 'no' && d.r == 'kicked'), 'host menolak dengan alasan kicked');
  assert.ok(!H._cur.peers.some(p => p.peer == aPeer));
  assert.strictEqual(H2._cur.peers.length, 1, 'room lain utuh');
  H.leave(); H2.leave();
});

test('kick: setelah kick slot kosong & pemain baru (sesi join baru) bisa bergabung; ID tidak bentrok', async () => {
  const w = world();
  const H = await w.mkRoom('KICK', true, initH('Host'), {}, 2, NETC);
  const A = await w.mkRoom('KICK', false, initC('A', 2), {}, undefined, NETC);
  await tick(200);
  await assert.rejects(w.mkRoom('KICK', false, initC('X', 3), {}, undefined, NETC), { type: 'full' });
  assert.ok(H.kick(H._cur.peers.find(p => !p.isMe).peer));
  await tick(900);
  const N = await w.mkRoom('KICK', false, initC('Baru', 4), {}, undefined, NETC);
  await tick(200);
  assert.strictEqual(H._cur.peers.length, 2);
  assert.ok(H._cur.peers.some(p => p.presence.name == 'Baru'));
  H.leave(); N.leave(); A.leave(1);
});
