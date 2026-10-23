'use strict';
// Uji logika UI "guest tidak boleh keluar" & layar "HOST TERPUTUS" (blok HOSTGUARD di index.html) dengan DOM tiruan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blk = /\/\/ <<HOSTGUARD([\s\S]*?)\/\/ HOSTGUARD>>/.exec(html);
assert.ok(blk, 'blok HOSTGUARD tidak ditemukan');

function env(lockLobby) {
  const els = {}, calls = [], timers = [];
  const mkEl = () => { const c = new Set(['hid']); return { classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x), toggle: (x, f) => (f ? c.add(x) : c.delete(x)) }, textContent: '', disabled: false, onclick: null }; };
  const $ = id => els[id] || (els[id] = mkEl());
  const ctx = {
    $, S: { mp: 0, host: 0 }, RM: null, calls, Date, Math, Set, console,
    toMenu: () => { calls.push('toMenu'); $('menu').classList.remove('hid'); },
    mpLeave: () => calls.push('mpLeave'),
    mpBack: m => calls.push(['mpBack', m]),
    setTimeout: (f, ms) => { timers.push({ f, ms, t: 1 }); return timers.length; }, clearTimeout: () => {},
    setInterval: f => { timers.push({ f, iv: 1 }); return timers.length; }, clearInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext((lockLobby ? blk[1].replace('GUEST_LOCK_LOBBY=false', 'GUEST_LOCK_LOBBY=true') : blk[1]) + '\nthis.guestLocked=guestLocked;', ctx);
  return { ctx, $, calls, timers, hidden: id => $(id).classList.contains('hid') };
}

test('guest saat game berjalan: tombol keluar terkunci, tidak ada toMenu, muncul petunjuk', () => {
  const e = env(); e.ctx.RM = {}; e.ctx.S.mp = 1; e.ctx.S.host = 0;
  assert.strictEqual(e.ctx.guestLocked(), true);
  e.ctx.syncExit();
  assert.strictEqual(e.$('bm').disabled, true);
  assert.match(e.$('bm').textContent, /DIKUNCI/);
  e.ctx.leaveReq();
  assert.ok(!e.calls.includes('toMenu'), 'guest tidak boleh keluar mandiri');
  assert.strictEqual(e.hidden('hn'), false);
});

test('guest di lobi: boleh keluar secara default; terkunci bila GUEST_LOCK_LOBBY=true', () => {
  let e = env(); e.ctx.RM = {}; e.ctx.S.mp = 0; e.ctx.S.host = 0;
  assert.strictEqual(e.ctx.guestLocked(), false);
  e = env(true); e.ctx.RM = {}; e.ctx.S.mp = 0; e.ctx.S.host = 0;
  assert.strictEqual(e.ctx.guestLocked(), true);
});

test('host: keluar butuh konfirmasi dua langkah; singleplayer langsung ke menu', () => {
  const e = env(); e.ctx.RM = {}; e.ctx.S.mp = 1; e.ctx.S.host = 1;
  e.ctx.syncExit();
  assert.strictEqual(e.$('bm').textContent, 'AKHIRI SESI');
  e.ctx.leaveReq();
  assert.ok(!e.calls.includes('toMenu'));
  assert.match(e.$('bm').textContent, /YAKIN/);
  e.ctx.leaveReq();
  assert.ok(e.calls.includes('toMenu'));
  const s = env(); s.ctx.leaveReq();
  assert.ok(s.calls.includes('toMenu'), 'singleplayer tidak berubah');
  s.ctx.syncExit(); assert.strictEqual(s.$('bm').textContent, 'MENU UTAMA'); assert.strictEqual(s.$('bm').disabled, false);
});

test('host terputus saat game: layar HOST TERPUTUS tampil, hitung mundur, lalu kembali ke lobby (sekali)', () => {
  const e = env(); e.ctx.RM = {}; e.ctx.S.mp = 1; e.ctx.S.host = 0;
  e.ctx.mpLost('bye');
  assert.ok(e.calls.includes('toMenu'));
  assert.strictEqual(e.hidden('hl'), false);
  assert.match(e.$('hlt').textContent, /HOST TERPUTUS/);
  assert.strictEqual(e.hidden('menu'), true, 'menu utama tidak menimpa layar');
  assert.match(e.$('hlm').textContent, /Host keluar/);
  e.ctx.mpLost('timeout'); // panggilan ganda diabaikan
  assert.strictEqual(e.calls.filter(c => c === 'toMenu').length, 1);
  const iv = e.timers.filter(t => t.iv).pop();
  for (let i = 0; i < 5; i++) iv.f();
  assert.ok(!e.calls.some(c => Array.isArray(c)), 'belum kembali sebelum hitung mundur selesai');
  assert.match(e.$('hlc').textContent, /1 detik/);
  iv.f();
  const back = e.calls.find(c => Array.isArray(c));
  assert.ok(back && /Host keluar/.test(back[1]));
  assert.strictEqual(e.hidden('hl'), true);
});

test('tombol KEMBALI SEKARANG langsung kembali; host putus di lobi memakai mpLeave', () => {
  const e = env(); e.ctx.RM = {}; e.ctx.S.mp = 0; e.ctx.S.host = 0;
  e.ctx.mpLost('timeout');
  assert.ok(e.calls.includes('mpLeave') && !e.calls.includes('toMenu'));
  assert.match(e.$('hlm').textContent, /terputus/);
  e.$('hlb').onclick();
  assert.ok(e.calls.some(c => Array.isArray(c)));
  assert.strictEqual(e.hidden('hl'), true);
  e.ctx.mpLost('bye'); // bisa terjadi lagi pada sesi berikutnya
  assert.strictEqual(e.hidden('hl'), false);
});

test('banner sambung-ulang muncul saat recon dan hilang saat pulih; diabaikan setelah sesi berakhir', () => {
  const e = env(); e.ctx.RM = {}; e.ctx.S.host = 0; e.ctx.S.mp = 1;
  e.ctx.onRoomState('recon', { ms: 10000 });
  assert.strictEqual(e.hidden('rcb'), false);
  assert.match(e.$('rcb').textContent, /menyambungkan ulang/);
  e.ctx.onRoomState('ok');
  assert.strictEqual(e.hidden('rcb'), true);
  e.ctx.mpLost('timeout');
  e.ctx.onRoomState('recon', { ms: 1000 });
  assert.strictEqual(e.hidden('rcb'), true);
});
