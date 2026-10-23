'use strict';
// Uji fitur NAMA CUSTOM PEMAIN: pembersih nama (klien == server), input & penyimpanan (DOM tiruan), pengiriman/penerimaan lewat protokol room
// (Peer tiruan di memori), tampilan per-pemain (nm/recName), reconnect, pemain keluar, dan metadata daftar server (registry + HTTP).
// CATATAN: protokol diuji di memori (bukan WebRTC/NAT sungguhan) — sama seperti p2p.test.js.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { Registry, cleanName: serverClean } = require('../server/rooms');
const { createHandler } = require('../server/http');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ---------- ekstraksi kode dari index.html
const cn = /\/\/ <<CLEANNAME[^\n]*\n([\s\S]*?)\/\/ CLEANNAME>>/.exec(html);
assert.ok(cn, 'blok CLEANNAME tidak ditemukan di index.html');
const pn = /const nm=p=>[\s\S]*?\/\/ PNAME>>/.exec(html);
assert.ok(pn, 'blok nm/recName/PNAME tidak ditemukan di index.html');
const blk = /const ICE=\{config[\s\S]*?(?=\nlet RM=null)/.exec(html);
assert.ok(blk, 'blok mkRoom tidak ditemukan di index.html');

const clientCtx = {};
vm.createContext(clientCtx);
vm.runInContext(cn[1] + '\nthis.cleanName=cleanName;this.NAME_MAX=NAME_MAX;', clientCtx);
const clientClean = clientCtx.cleanName;

// ---------- harness Peer tiruan (dipakai bersama p2p.test.js)
const ALL = [];
afterEach(() => { ALL.splice(0).forEach(r => { try { r.leave(1); } catch (e) { /* sudah ditutup */ } }); });
const p2p = fs.readFileSync(path.join(__dirname, 'p2p.test.js'), 'utf8');
const wsrc = /function world\(\) \{[\s\S]*?\n\}\n(?=const NETC)/.exec(p2p);
assert.ok(wsrc, 'harness world() tidak ditemukan');
const world = new Function('vm', 'm', 'ALL', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', wsrc[0] + '\nreturn world;')(vm, blk, ALL, setImmediate, setTimeout, clearTimeout, setInterval, clearInterval);

const NETC = { prefix: 'b14o-', peer: { host: 'x', port: 443, secure: true, path: '/peerjs' } };
const initH = (n) => ({ name: n, hat: 0, sh: 0, pn: 0, rdy: 0, host: 1, g: 0, t0: 1, sn: 'Server Uji' });
const initC = (n, t) => ({ name: n, hat: 1, sh: 2, pn: 3, rdy: 0, host: 0, g: 0, t0: t });
const FAST = { SILENT: 400, GRACE: 700, AWAY: 900, WD: 50, RETRY: 200, HB: 100 };
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms));
// peta {peerId: nama} sebagaimana dilihat satu sisi; dan nama milik sendiri
const view = r => Object.fromEntries(r._cur.peers.map(p => [p.peer, p.presence.name]));
const sortedNames = r => Array.from(r._cur.peers, p => p.presence.name).sort(); // Array.from: hasil berada di realm uji (bukan realm vm) agar deepStrictEqual valid
const mine = r => r._cur.peers.find(p => p.isMe).presence.name;

// =====================================================================
// 1. Pembersih nama
// =====================================================================
test('cleanName: default "Pemain" untuk kosong/null/spasi/semua karakter tidak valid', () => {
  for (const v of ['', '   ', null, undefined, '<<>>', '!!!', '\u0000\u0001', '\n\t', '()', '★']) assert.strictEqual(clientClean(v), 'Pemain', JSON.stringify(v));
});

test('cleanName: maksimal 16 karakter, karakter tidak valid dibuang, spasi dirapikan', () => {
  assert.strictEqual(clientClean('A'.repeat(40)), 'A'.repeat(16));
  assert.strictEqual(clientClean('  Budi   Keren  '), 'Budi Keren');
  assert.strictEqual(clientClean('<b>Budi</b>'), 'bBudib');
  assert.strictEqual(clientClean('Bu\u0000di\u0007'), 'Budi');
  assert.strictEqual(clientClean('Ana_01 x.y-z'), 'Ana_01 x.y-z');
  assert.strictEqual(clientClean('Siti (kamu) ★ HOST'), 'Siti kamu HOST', 'tanda kurung & bintang dibuang agar tidak bisa meniru label sistem');
  assert.strictEqual(clientClean('Ünïcode Ñandú'), 'Ünïcode Ñandú');
  assert.strictEqual(clientClean('名前テスト'), '名前テスト');
  assert.strictEqual(clientClean('a\nb\tc'), 'a b c');
  assert.ok(Array.from(clientClean('😀'.repeat(30))).length <= 16);
  assert.strictEqual(clientClean('x'.repeat(15) + ' yyy'), 'x'.repeat(15), 'hasil dipotong lalu dirapikan lagi (tidak berakhir spasi)');
  assert.strictEqual(clientClean(12345), '12345');
  assert.strictEqual(clientClean({ a: 1 }), 'object Object', 'objek diubah ke teks lalu dibersihkan, tidak melempar error');
});

test('cleanName: fallback kustom dipakai bila hasil kosong (dipakai cl() agar pembaruan tidak menimpa nama lama)', () => {
  assert.strictEqual(clientClean('', ''), '');
  assert.strictEqual(clientClean('<>', ''), '');
  assert.strictEqual(clientClean('Ok', ''), 'Ok');
});

test('cleanName klien == cleanName server untuk banyak masukan (nama host di daftar server = nama di lobi)', () => {
  const samples = ['', ' ', 'Budi', '  Budi   Keren ', 'A'.repeat(50), '<script>alert(1)</script>', 'Siti (1)', 'Ünï', '名前', '😀😀😀', 'a\u0000b', 'x.y_z-w\'s', null, undefined, 42, '\u200bBudi\u200b', 'ＡＢＣ', 'e\u0301cole'];
  for (const v of samples) assert.strictEqual(serverClean(v), clientClean(v), JSON.stringify(v));
});

// =====================================================================
// 2. Input nama, penyimpanan, nama server bawaan vs kustom (DOM tiruan)
// =====================================================================
function uiEnv(initialName) {
  const els = {}, saves = [];
  const mkEl = id => ({ id, value: '' });
  const $ = id => els[id] || (els[id] = mkEl(id));
  ['nm', 'pnl', 'pno', 'osn'].forEach($);
  const ctx = { $, S: { peers: [], names: null }, C: { name: initialName || 'Diamond231' }, saveC: () => saves.push('save'), Array, String, Number, Math, console };
  vm.createContext(ctx);
  vm.runInContext(cn[1] + '\n' + pn[0] + '\nthis.nm=nm;this.recName=recName;this.pnLive=pnLive;this.pnDone=pnDone;this.pnCommit=pnCommit;this.pnSet=pnSet;this.osnAuto=osnAuto;', ctx);
  return { ctx, $, saves };
}
const typeInto = (e, id, v) => { e.$(id).value = v; e.ctx.pnLive({ target: e.$(id) }); };

test('UI: nama awal tampil di semua kolom nama dan nama server bawaan mengikutinya', () => {
  const e = uiEnv('Diamond231');
  assert.strictEqual(e.$('nm').value, 'Diamond231');
  assert.strictEqual(e.$('pnl').value, 'Diamond231');
  assert.strictEqual(e.$('pno').value, 'Diamond231');
  assert.strictEqual(e.$('osn').value, 'Server Diamond231');
});

test('UI: mengetik nama -> C.name, disimpan, dan semua kolom lain ikut (nama dipertahankan di semua layar)', () => {
  const e = uiEnv();
  typeInto(e, 'pno', 'Budi Keren');
  assert.strictEqual(e.ctx.C.name, 'Budi Keren');
  assert.strictEqual(e.$('pnl').value, 'Budi Keren');
  assert.strictEqual(e.$('nm').value, 'Budi Keren');
  assert.ok(e.saves.length > 0, 'saveC() dipanggil (tersimpan di localStorage)');
});

test('UI: karakter tidak valid dibuang langsung di kolom; panjang dibatasi 16; spasi akhir tidak mengganggu pengetikan', () => {
  const e = uiEnv();
  typeInto(e, 'pnl', 'Bu<di>!!');
  assert.strictEqual(e.$('pnl').value, 'Budi');
  typeInto(e, 'pnl', 'Z'.repeat(40));
  assert.strictEqual(e.$('pnl').value, 'Z'.repeat(16));
  assert.strictEqual(e.ctx.C.name, 'Z'.repeat(16));
  typeInto(e, 'pnl', 'Ana ');
  assert.strictEqual(e.$('pnl').value, 'Ana ', 'spasi akhir dibiarkan saat mengetik');
  assert.strictEqual(e.ctx.C.name, 'Ana', 'tetapi nama yang dipakai sudah dirapikan');
  e.ctx.pnDone({ target: e.$('pnl') });
  assert.strictEqual(e.$('pnl').value, 'Ana', 'saat selesai (blur/change) kolom dirapikan');
});

test('UI: nama kosong -> "Pemain" (kolom diisi "Pemain" setelah selesai, dan itu yang dikirim)', () => {
  const e = uiEnv('Budi');
  typeInto(e, 'pno', '');
  assert.strictEqual(e.ctx.C.name, 'Pemain');
  e.ctx.pnDone({ target: e.$('pno') });
  assert.strictEqual(e.$('pno').value, 'Pemain');
  typeInto(e, 'pnl', '   ');
  assert.strictEqual(e.ctx.C.name, 'Pemain');
});

test('UI: pnCommit(net) mengambil nama dari kolom layar yang dipakai saat tombol BUAT/GABUNG ditekan', () => {
  const e = uiEnv('Lama');
  e.$('pno').value = 'Online  Ana<>';   // tanpa event input (mis. isian otomatis browser)
  assert.strictEqual(e.ctx.pnCommit('online'), 'Online Ana');
  assert.strictEqual(e.ctx.C.name, 'Online Ana');
  assert.strictEqual(e.$('pno').value, 'Online Ana');
  e.$('pnl').value = 'Lan Budi';
  assert.strictEqual(e.ctx.pnCommit('lan'), 'Lan Budi');
  assert.strictEqual(e.ctx.C.name, 'Lan Budi');
  e.$('pnl').value = '';
  assert.strictEqual(e.ctx.pnCommit('lan'), 'Pemain');
});

test('UI: nama server BAWAAN mengikuti nama host, tetapi nama server KUSTOM tidak pernah ditimpa', () => {
  const e = uiEnv('Budi');
  assert.strictEqual(e.$('osn').value, 'Server Budi');
  typeInto(e, 'pno', 'Ana');
  assert.strictEqual(e.$('osn').value, 'Server Ana', 'bawaan ikut berubah');
  e.$('osn').value = 'Warung Horor';          // pemain mengetik nama server sendiri
  typeInto(e, 'pno', 'Citra');
  assert.strictEqual(e.$('osn').value, 'Warung Horor', 'kustom tidak ditimpa saat nama host berubah');
  e.ctx.pnCommit('online');
  assert.strictEqual(e.$('osn').value, 'Warung Horor', 'dan tidak ditimpa saat komit nama');
  e.$('osn').value = '';                       // dikosongkan -> kembali ke bawaan
  e.ctx.osnAuto();
  assert.strictEqual(e.$('osn').value, 'Server Citra');
});

test('UI: nama server bawaan terpanjang tetap muat di batas 24 karakter server', () => {
  const e = uiEnv('Z'.repeat(16));
  assert.ok(e.$('osn').value.length <= 24, e.$('osn').value);
});

// =====================================================================
// 3. Tampilan per-pemain (nm / recName): tidak ada nama yang tertimpa
// =====================================================================
const peer = (id, name, t0, extra) => ({ peer: id, presence: Object.assign({ name, t0 }, extra || {}) });

test('recName/nm: setiap pemain tampil dengan namanya sendiri (host tidak menimpa nama guest)', () => {
  const e = uiEnv();
  e.ctx.S.peers = [peer('H', 'Host Satu', 1, { host: 1 }), peer('A', 'Ana', 2), peer('B', 'Budi', 3)];
  e.ctx.recName();
  assert.deepStrictEqual(e.ctx.S.peers.map(e.ctx.nm), ['Host Satu', 'Ana', 'Budi']);
});

test('recName/nm: nama kembar diberi akhiran yang sama di semua klien; nama kosong/rusak -> "Pemain"', () => {
  const e = uiEnv();
  e.ctx.S.peers = [peer('H', 'Budi', 1, { host: 1 }), peer('A', 'budi', 2), peer('B', 'BUDI', 3), peer('C', '', 4), peer('D', undefined, 5), peer('E', '<x>', 6)];
  e.ctx.recName();
  assert.deepStrictEqual(e.ctx.S.peers.map(e.ctx.nm), ['Budi', 'budi (1)', 'BUDI (2)', 'Pemain', 'Pemain (1)', 'x']);
  // urutan daftar berbeda -> hasil sama (deterministik berdasarkan t0 lalu id)
  const e2 = uiEnv();
  e2.ctx.S.peers = [...e.ctx.S.peers].reverse().map(p => ({ peer: p.peer, presence: p.presence }));
  e2.ctx.recName();
  const map = x => Object.fromEntries(x.ctx.S.peers.map(p => [p.peer, x.ctx.nm(p)]));
  assert.deepStrictEqual(map(e2), map(e));
});

// =====================================================================
// 4. Protokol room: nama sampai ke semua sisi, konsisten
// =====================================================================
test('host + 3 guest dengan nama berbeda: semua sisi melihat daftar yang sama dan nama diri sendiri benar', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  const D = await w.mkRoom('ABCD', false, initC('Dewi_9', 4), {}, undefined, NETC);
  await tick(250);
  const want = ['Ana', 'Budi', 'Dewi_9', 'Host Satu'];
  for (const r of [H, A, B, D]) { assert.deepStrictEqual(sortedNames(r), want); }
  assert.strictEqual(mine(H), 'Host Satu');
  assert.strictEqual(mine(A), 'Ana');
  assert.strictEqual(mine(B), 'Budi');
  assert.strictEqual(mine(D), 'Dewi_9');
  // peta id->nama identik di semua sisi (tidak ada nama yang tertukar/tertimpa)
  assert.deepStrictEqual(view(A), view(H));
  assert.deepStrictEqual(view(B), view(H));
  assert.deepStrictEqual(view(D), view(H));
});

test('nama yang tidak valid dari klien dibersihkan oleh HOST (jaminan sisi penerima, bukan hanya input)', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('<img src=x onerror=1>', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('N'.repeat(60), 3), {}, undefined, NETC);
  const C = await w.mkRoom('ABCD', false, initC('', 4), {}, undefined, NETC);
  await tick(250);
  const v = view(H);
  assert.deepStrictEqual(Object.values(v).sort(), ['Host', 'N'.repeat(16), 'Pemain', 'img srcx onerror'].sort());
  assert.deepStrictEqual(view(C), v);
  assert.ok(!/[<>]/.test(Object.values(v).join('')));
});

test('klien tanpa field nama sama sekali -> "Pemain" (bukan "undefined"/"?")', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host'), {}, 4, NETC);
  const init = initC('x', 2); delete init.name;
  const A = await w.mkRoom('ABCD', false, init, {}, undefined, NETC);
  await tick();
  assert.strictEqual(mine(A), 'Pemain');
  assert.deepStrictEqual(sortedNames(H), ['Host', 'Pemain']);
});

test('pemain baru bergabung belakangan: namanya muncul di semua sisi, nama lama tidak berubah', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  await tick();
  assert.deepStrictEqual(sortedNames(A), ['Ana', 'Host Satu']);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick(250);
  for (const r of [H, A, B]) assert.deepStrictEqual(sortedNames(r), ['Ana', 'Budi', 'Host Satu']);
  assert.deepStrictEqual(view(B), view(H));
});

test('pembaruan presence (posisi, READY) tidak mengubah nama; guest tidak bisa menimpa nama pemain lain lewat presence', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick(200);
  const before = view(H);
  await A.presence({ rdy: 1, x: 3, z: 4, r: 1, sc: 'b' });
  await B.presence({ x: 9, z: 1 });
  await H.presence({ x: 1, z: 1 });
  await tick(250);
  assert.deepStrictEqual(view(H), before);
  assert.deepStrictEqual(view(A), before);
  assert.deepStrictEqual(view(B), before);
  // Ana mencoba mengganti namanya sendiri dengan nama tidak valid/kosong -> ditolak (nama lama tetap)
  await A.presence({ name: '' });
  await A.presence({ name: '<>' });
  await tick(250);
  assert.deepStrictEqual(view(H), before, 'nama kosong/tidak valid pada pembaruan tidak menimpa nama lama');
  // pembaruan nama sah hanya mengubah entri Ana sendiri (dan sudah dibersihkan)
  await A.presence({ name: 'Ana  Baru<' });
  await tick(250);
  const after = view(H), idA = A._cur.peers.find(p => p.isMe).peer;
  assert.strictEqual(after[idA], 'Ana Baru');
  for (const id of Object.keys(before)) if (id !== idA) assert.strictEqual(after[id], before[id], 'nama pemain lain tidak berubah');
});

test('RECONNECT: guest putus sebentar lalu tersambung lagi -> nama tidak rusak/tertukar di host maupun guest', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), { T: FAST }, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), { T: FAST }, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), { T: FAST }, undefined, NETC);
  await tick(250);
  const before = view(H);
  const idA = A._cur.peers.find(p => p.isMe).peer;
  w.freeze(idA);               // internet Ana putus
  await tick(550);             // melewati SILENT (host menahan slot, "menyambung ulang")
  w.thaw(idA);                 // tersambung kembali sebelum AWAY habis
  await tick(1200);
  assert.deepStrictEqual(view(H), before, 'host: nama sama persis setelah reconnect');
  assert.deepStrictEqual(view(A), before, 'Ana: nama sama setelah reconnect');
  assert.deepStrictEqual(view(B), before, 'Budi: nama sama setelah reconnect');
  assert.strictEqual(mine(A), 'Ana');
});

test('RECONNECT tidak menimpa nama dengan nama pemain lain / host walau Ana memberi nama berbeda saat tersambung ulang', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), { T: FAST }, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), { T: FAST }, undefined, NETC);
  await tick(250);
  const idA = A._cur.peers.find(p => p.isMe).peer;
  w.freeze(idA); await tick(550); w.thaw(idA); await tick(1200);
  assert.strictEqual(view(H)[idA], 'Ana');
  assert.strictEqual(Object.values(view(H)).filter(n => n === 'Host Satu').length, 1, 'nama host tidak muncul dua kali');
});

test('pemain keluar: sisa pemain tetap memakai nama masing-masing; pemain baru tidak mewarisi nama yang keluar', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick(250);
  const idB = B._cur.peers.find(p => p.isMe).peer;
  const idA = A._cur.peers.find(p => p.isMe).peer;
  const vb = view(H);
  A.leave();                       // Ana keluar sendiri
  await tick(500);
  assert.deepStrictEqual(sortedNames(H), ['Budi', 'Host Satu']);
  assert.deepStrictEqual(sortedNames(B), ['Budi', 'Host Satu']);
  assert.strictEqual(view(H)[idB], vb[idB], 'nama Budi tidak berubah');
  assert.ok(!(idA in view(H)), 'Ana hilang dari daftar');
  const C = await w.mkRoom('ABCD', false, initC('Citra', 5), {}, undefined, NETC);
  await tick(250);
  assert.deepStrictEqual(sortedNames(C), ['Budi', 'Citra', 'Host Satu']);
  assert.deepStrictEqual(view(C), view(H));
});

test('kick: guest yang di-kick hilang dengan namanya; nama lain utuh', async () => {
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Satu'), {}, 4, NETC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), {}, undefined, NETC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), {}, undefined, NETC);
  await tick(250);
  const idA = A._cur.peers.find(p => p.isMe).peer;
  assert.strictEqual(H.kick(idA), true);
  await tick(300);
  assert.deepStrictEqual(sortedNames(H), ['Budi', 'Host Satu']);
  assert.deepStrictEqual(sortedNames(B), ['Budi', 'Host Satu']);
});

test('LAN (host migration): setelah host pindah, nama semua pemain tetap benar & tidak tertimpa nama host lama', async () => {
  const LANC = { prefix: 'b14l-', peer: { host: 'x' }, mig: true };
  const w = world();
  const H = await w.mkRoom('ABCD', true, initH('Host Lama'), { T: FAST }, 4, LANC);
  const A = await w.mkRoom('ABCD', false, initC('Ana', 2), { T: FAST }, undefined, LANC);
  const B = await w.mkRoom('ABCD', false, initC('Budi', 3), { T: FAST }, undefined, LANC);
  await tick(300);
  assert.deepStrictEqual(sortedNames(B), ['Ana', 'Budi', 'Host Lama']);
  H.leave(1);                      // host LAN keluar -> pemilihan host baru
  await tick(2500);
  for (const r of [A, B]) {
    const names = sortedNames(r);
    assert.ok(names.includes('Ana') && names.includes('Budi'), 'nama guest utuh: ' + names);
    assert.strictEqual(mine(r), r === A ? 'Ana' : 'Budi');
    assert.ok(!names.includes('Host Lama'), 'host lama sudah tidak ada: ' + names);
    assert.strictEqual(new Set(names).size, names.length, 'tidak ada nama kembar karena tertimpa');
  }
  assert.deepStrictEqual(view(A), view(B));
});

// =====================================================================
// 5. Server: metadata daftar server memakai nama host kustom tanpa menimpa nama server kustom
// =====================================================================
test('registry: hostName memakai nama host kustom (dibersihkan), nama server kustom tidak ditimpa', () => {
  const r = new Registry();
  const a = r.create({ id: 'ABCD', name: 'Warung Horor', hostName: 'Budi Keren', mode: 'online' }, '1.1.1.1');
  assert.strictEqual(a.hostName, 'Budi Keren');
  assert.strictEqual(a.name, 'Warung Horor');
  const b = r.create({ id: 'EFGH', hostName: 'Siti', mode: 'online' }, '1.1.1.2');
  assert.strictEqual(b.name, 'Server Siti', 'tanpa nama server -> "Server <host>"');
  const c = r.create({ id: 'JKLM', name: 'Server Lama', hostName: '<b>Ana</b>', mode: 'online' }, '1.1.1.3');
  assert.strictEqual(c.hostName, 'bAnab');
  assert.strictEqual(c.name, 'Server Lama');
  const d = r.create({ id: 'NPQR', hostName: '', mode: 'lan' }, '1.1.1.4');
  assert.strictEqual(d.hostName, 'Pemain');
  const e = r.create({ id: 'STUV', hostName: 'H'.repeat(80), mode: 'online' }, '1.1.1.5');
  assert.strictEqual(e.hostName, 'H'.repeat(16));
  const L = r.list('online');
  assert.deepStrictEqual(L.map(x => x.hostName).sort(), ['Budi Keren', 'H'.repeat(16), 'Siti', 'bAnab'].sort());
});

test('registry: hostName bukan teks (angka/objek/null) tidak membuat error', () => {
  const r = new Registry();
  assert.strictEqual(r.create({ id: 'ABCD', hostName: 123 }, '1.1.1.1').hostName, '123');
  assert.strictEqual(r.create({ id: 'EFGH', hostName: null }, '1.1.1.2').hostName, 'Pemain');
  assert.doesNotThrow(() => r.create({ id: 'JKLM', hostName: { a: 1 } }, '1.1.1.3'));
});

test('HTTP: nama host & nama server kustom (termasuk Unicode) bolak-balik lewat POST -> GET /api/rooms', async () => {
  const reg = new Registry();
  const h = createHandler(reg, { allowedOrigins: ['*'] });
  const srv = http.createServer((q, s) => h(q, s, () => { s.statusCode = 404; s.end('{}'); }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const post = (b) => fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
    await post({ id: 'ABCD', name: 'Ruang Ñandú', hostName: 'Ünïcode Ñandú', mode: 'online' });
    await post({ id: 'WXYZ', hostName: 'Ana', mode: 'online' });
    const j = await fetch(base + '/api/rooms?mode=online').then(r => r.json());
    const by = Object.fromEntries(j.rooms.map(x => [x.id, x]));
    assert.strictEqual(by.ABCD.hostName, 'Ünïcode Ñandú');
    assert.strictEqual(by.ABCD.name, 'Ruang Ñandú');
    assert.strictEqual(by.WXYZ.hostName, 'Ana');
    assert.strictEqual(by.WXYZ.name, 'Server Ana');
  } finally { await new Promise(r => srv.close(r)); }
});

// =====================================================================
// 6. Kode di index.html: alur nama terhubung & tidak ada error sintaks
// =====================================================================
test('index.html: semua <script> inline lolos pemeriksaan sintaks (tidak ada error JavaScript saat dimuat)', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  scripts.forEach((s, i) => assert.doesNotThrow(() => new vm.Script(s, { filename: 'inline-' + i + '.js' }), 'script inline #' + i));
});

test('index.html: ada kolom nama di layar LAN, layar ONLINE, dan Pengaturan (maks 16), dan select nama lama sudah tidak ada', () => {
  for (const id of ['pnl', 'pno', 'nm']) {
    const m = new RegExp('<input id="' + id + '"[^>]*>').exec(html);
    assert.ok(m, 'input #' + id + ' tidak ada');
    assert.match(m[0], /maxlength="16"/);
    assert.match(m[0], /placeholder="Pemain"/);
  }
  assert.ok(!/<select id="nm"/.test(html), 'select nama lama harus diganti input bebas');
});

test('index.html: mpJoin mengunci nama dari kolom input sebelum membuat init presence; hostName registry dari nama yang sama', () => {
  const j = /async function mpJoin\([\s\S]*?\n(?=\/\/ -{10})/.exec(html);
  assert.ok(j, 'mpJoin tidak ditemukan');
  const src = j[0];
  const iCommit = src.indexOf('pnCommit(net)'), iInit = src.indexOf('const init={name:C.name');
  assert.ok(iCommit > 0 && iInit > iCommit, 'pnCommit(net) harus dipanggil sebelum init presence dibuat');
  assert.match(html, /hostName:C\.name,max,hidden/, 'REG menyimpan hostName');
  assert.ok(!/hostName:C\.name,mode:r\.mode/.test(html), 'pendaftaran ulang registry memakai r.hostName, bukan C.name yang bisa berubah');
  assert.match(html, /const lanName=\(\)=>\{pnCommit\('lan'\)/);
});

test('index.html: nama presence selalu lewat cleanName di sisi host (cl) dan tampilan (nm/recName)', () => {
  assert.match(html, /k=='name'\?cleanName\(v,''\)/);
  assert.match(html, /const nm=p=>\(S\.names&&S\.names\[p\.peer\]\)\|\|cleanName\(/);
  assert.match(html, /const b=cleanName\(p\.presence&&p\.presence\.name\)/);
  assert.ok(!/String\(p\.presence\.name\|\|'\?'\)/.test(html), 'jalur lama tanpa pembersih sudah hilang');
});
