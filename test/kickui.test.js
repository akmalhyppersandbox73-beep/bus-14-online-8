'use strict';
// Uji UI Kick di lobi (blok "KICK PLAYER" di index.html) dengan DOM tiruan: tombol hanya untuk host & hanya pada pemain lain,
// konfirmasi lewat dialog game (#kc), tanpa window.confirm / iframe / halaman tambahan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blk = /\/\/ ---------- KICK PLAYER[\s\S]*?(?=\nfunction lobby\(\))/.exec(html);
assert.ok(blk, 'blok KICK PLAYER tidak ditemukan');

function env({ host }) {
  const els = {}, hints = [], kicked = [];
  const mk = (tag) => { const c = new Set(); const e = { tag, children: [], className: '', textContent: '', onclick: null,
    classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) },
    append(...a) { this.children.push(...a); }, replaceChildren() { this.children = []; } }; return e; };
  const $ = id => els[id] || (els[id] = mk('#' + id));
  $('kc').classList.add('hid');
  const ctx = { $, document: { createElement: mk }, S: { host, peers: [] }, RM: { kick: id => { kicked.push(id); return true; } }, hint: m => hints.push(m), nm: p => p.presence.name, console };
  vm.createContext(ctx);
  vm.runInContext(blk[0] + '\nthis.lobbyList=lobbyList;this.kickAsk=kickAsk;this.kickYes=kickYes;this.kickNo=kickNo;', ctx);
  return { ctx, $, hints, kicked };
}
const P = [
  { peer: 'h', isMe: true, presence: { name: 'Host', host: 1 } },
  { peer: 'a', isMe: false, presence: { name: 'Ana', rdy: 1 } },
  { peer: 'b', isMe: false, presence: { name: 'Budi' }, away: 1 },
];
const buttons = e => e.$('mpl').children.flatMap(r => r.children.filter(c => c.tag == 'button'));

test('host: tombol KICK hanya pada pemain lain (bukan dirinya)', () => {
  const e = env({ host: 1 }); e.ctx.lobbyList(P);
  assert.strictEqual(e.$('mpl').children.length, 3);
  assert.strictEqual(buttons(e).length, 2);
  assert.ok(buttons(e).every(b => b.textContent == 'KICK'));
  assert.strictEqual(e.$('mpl').children[0].children.some(c => c.tag == 'button'), false, 'baris host tanpa tombol');
});

test('guest: tidak ada tombol Kick sama sekali; kickAsk diabaikan', () => {
  const e = env({ host: 0 }); e.ctx.lobbyList(P);
  assert.strictEqual(buttons(e).length, 0);
  e.ctx.kickAsk(P[1]);
  assert.ok(e.$('kc').classList.contains('hid'), 'dialog tidak muncul untuk guest');
});

test('klik KICK -> dialog konfirmasi in-game; BATAL tidak mengeluarkan; YA mengeluarkan target tepat', () => {
  const e = env({ host: 1 }); e.ctx.lobbyList(P);
  buttons(e)[0].onclick();
  assert.ok(!e.$('kc').classList.contains('hid'));
  assert.match(e.$('kcm').textContent, /Ana/);
  e.ctx.kickNo(); assert.ok(e.$('kc').classList.contains('hid')); assert.deepStrictEqual(e.kicked, []);
  buttons(e)[0].onclick(); e.ctx.kickYes();
  assert.deepStrictEqual(e.kicked, ['a']);
  assert.ok(e.$('kc').classList.contains('hid'));
  assert.ok(e.hints.length == 1);
});

test('host tidak bisa kick diri sendiri / host lain lewat kickAsk; target yang sudah pergi menutup dialog', () => {
  const e = env({ host: 1 }); e.ctx.lobbyList(P);
  e.ctx.kickAsk(P[0]); assert.ok(e.$('kc').classList.contains('hid'));
  e.ctx.kickAsk(P[1]); assert.ok(!e.$('kc').classList.contains('hid'));
  e.ctx.lobbyList([P[0], P[2]]); // Ana sudah keluar
  assert.ok(e.$('kc').classList.contains('hid'));
  e.ctx.kickYes(); assert.deepStrictEqual(e.kicked, []);
});

test('tidak memakai window.confirm / iframe / halaman tambahan untuk Kick', () => {
  assert.ok(!/confirm\(/.test(blk[0]));
  assert.ok(!/<iframe/i.test(html));
});
