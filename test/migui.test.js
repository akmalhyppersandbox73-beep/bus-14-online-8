'use strict';
// Uji sisi UI/game dari HOST MIGRATION (blok HOSTGUARD di index.html) dengan DOM tiruan:
// label keluar host LAN, notifikasi, serah-terima peran host (sync voting/board), pendaftaran ulang registry LAN.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blk = /\/\/ <<HOSTGUARD([\s\S]*?)\/\/ HOSTGUARD>>/.exec(html);
assert.ok(blk, 'blok HOSTGUARD tidak ditemukan');

function env(over) {
  const els = {}, calls = [], timers = [];
  const mkEl = () => { const c = new Set(['hid']); return { classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x), toggle: (x, f) => (f ? c.add(x) : c.delete(x)) }, textContent: '', disabled: false, onclick: null }; };
  const $ = id => els[id] || (els[id] = mkEl());
  const ctx = Object.assign({
    $, S: { mp: 0, host: 0, mode: 'menu', n: 3, mpA: 5, sd: 77, dopen: 0, peers: [] }, RM: {}, calls, Date, Math, Set, console, V: null, MSY: null, MIGI: null, migOld: '', lastNet: 'lan', C: { name: 'Aku' },
    toMenu: () => calls.push('toMenu'), mpLeave: () => calls.push('mpLeave'), mpBack: () => {}, lobby: () => calls.push('lobby'), hidUI: () => {},
    hp: () => ({ peer: 'h1', presence: { name: 'Budi', host: 1 } }), nm: p => p.presence.name, me: () => ({ presence: { sn: 'Server Uji', mx: 3 } }),
    mpe: d => calls.push(['mpe', d]), genA: () => 9,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {}, setInterval: f => { timers.push({ f, iv: 1 }); return timers.length; }, clearInterval: () => {},
    regStart: async (...a) => { calls.push(['regStart', ...a]); },
  }, over || {});
  vm.createContext(ctx);
  vm.runInContext(blk[1] + '\nthis.syncExit=syncExit;this.leaveReq=leaveReq;this.onMigEv=onMigEv;this.onNewHost=onNewHost;this.sendSync=sendSync;this.onRoomState=onRoomState;this.regReopen=regReopen;this.onPeerUp=onPeerUp;', ctx);
  return { ctx, $, calls, timers };
}

test('LAN: host di menu jeda melihat tombol keluar bernada "host pindah", bukan "akhiri sesi"; ONLINE tetap "AKHIRI SESI"', () => {
  let e = env(); e.ctx.S.mp = 1; e.ctx.S.host = 1; e.ctx.syncExit();
  assert.match(e.$('bm').textContent, /HOST PINDAH/);
  e.ctx.leaveReq(); assert.match(e.$('bm').textContent, /HOST PINDAH KE PEMAIN LAIN/); assert.ok(!e.calls.includes('toMenu'));
  e.ctx.leaveReq(); assert.ok(e.calls.includes('toMenu'), 'konfirmasi kedua keluar');
  e = env({ lastNet: 'online' }); e.ctx.S.mp = 1; e.ctx.S.host = 1; e.ctx.syncExit();
  assert.strictEqual(e.$('bm').textContent, 'AKHIRI SESI');
});

test('guest LAN kini boleh keluar sendiri saat game berjalan (tombol aktif, konfirmasi dulu)', () => {
  const e = env(); e.ctx.S.mp = 1; e.ctx.S.host = 0; e.ctx.syncExit();
  assert.strictEqual(e.$('bm').disabled, false);
  assert.match(e.$('bm').textContent, /KELUAR DARI ROOM/);
  e.ctx.leaveReq();
  assert.strictEqual(e.$('lc').classList.contains('hid'), false);
  assert.ok(!e.calls.includes('toMenu'));
});

test('notifikasi: pemilihan sedang berjalan, lalu host lama terputus & host baru diumumkan di UI game', () => {
  const e = env(); e.ctx.onRoomState('elect');
  assert.match(e.$('rcb').textContent, /memilih host baru/); assert.strictEqual(e.$('rcb').classList.contains('hid'), false);
  assert.strictEqual(e.ctx.migOld, 'Budi');
  e.ctx.S.peers = [{ peer: 'g2', presence: { name: 'Citra', host: 1 } }];
  e.ctx.onMigEv('done', { host: 'g2' });
  assert.match(e.$('hn').textContent, /Host lama \(Budi\) terputus\. Citra kini menjadi host/);
  assert.strictEqual(e.$('rcb').classList.contains('hid'), true);
  assert.ok(e.calls.includes('lobby'));
});

test('pemain terpilih: S.host=1, notifikasi, tombol keluar host, registry LAN didaftarkan ulang', async () => {
  const e = env(); e.ctx.migOld = 'Budi'; e.ctx.MIGI = { id: 'ABCD', tg: { api: 'http://x/api' } }; e.ctx.S.mp = 1;
  e.ctx.onNewHost({});
  assert.strictEqual(e.ctx.S.host, 1);
  assert.match(e.$('hn').textContent, /Kamu sekarang menjadi host/);
  await new Promise(r => setImmediate(r));
  const rs = e.calls.find(c => c[0] == 'regStart'); assert.ok(rs, 'registry didaftarkan ulang');
  assert.strictEqual(rs[3], 'ABCD'); assert.strictEqual(rs[2], 'lan'); assert.strictEqual(rs[4], 'Server Uji'); assert.strictEqual(rs[5], 3); assert.strictEqual(rs[6], false);
});

test('registry: tanpa server LAN lokal (tanpa api) tidak mencoba mendaftar; 409 dicoba ulang', async () => {
  let e = env(); e.ctx.MIGI = { id: 'ABCD', tg: { api: null } }; e.ctx.S.host = 1; await e.ctx.regReopen();
  assert.ok(!e.calls.some(c => c[0] == 'regStart'));
  let n = 0;
  e = env({ regStart: async () => { if (++n < 2) throw { type: 'http', status: 409 }; } , setTimeout: (f) => { f(); return 1; } });
  e.ctx.MIGI = { id: 'ABCD', tg: { api: 'http://x/api' } }; e.ctx.S.host = 1; await e.ctx.regReopen();
  assert.strictEqual(n, 2, 'dicoba ulang setelah 409 lalu berhasil');
});

test('serah-terima gameplay: host baru membersihkan voting lama, mengirim sync saat di bus, dan board saat di terminal', () => {
  let e = env(); e.ctx.S.mp = 1; e.ctx.S.host = 1; e.ctx.MSY = { n: 0, b: 0 }; e.ctx.S.mode = 'bus';
  e.ctx.sendSync();
  assert.strictEqual(JSON.stringify(e.calls.filter(c => c[0] == 'mpe').map(c => c[1])), JSON.stringify([{ t: 'vote', k: null }, { t: 'sync', n: 3, a: 5, sd: 77 }]));
  e = env(); e.ctx.S.mp = 1; e.ctx.S.host = 1; e.ctx.MSY = { n: 0, b: 0 }; e.ctx.S.mode = 'term'; e.ctx.S.dopen = 1;
  e.ctx.sendSync(); e.ctx.sendSync();
  const t = e.timers.filter(x => x.ms == 1500); assert.strictEqual(t.length, 1, 'board dijadwalkan sekali');
  t[0].f(); const b = e.calls.filter(c => c[0] == 'mpe' && c[1].t == 'board'); assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0][1].a, 9);
  e = env(); e.ctx.S.mp = 1; e.ctx.S.host = 1; e.ctx.MSY = { n: 0, b: 0 }; e.ctx.V = { k: 'exit' }; e.ctx.S.mode = 'bus';
  e.ctx.sendSync(); assert.ok(!e.calls.some(c => c[0] == 'mpe' && c[1].k === null && c[1].t == 'vote'), 'voting yang sedang berjalan tidak dihapus');
});
