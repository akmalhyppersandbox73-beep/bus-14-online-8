'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Registry } = require('../server/rooms');

test('buat room, muncul di daftar, token unik', () => {
  const r = new Registry();
  const a = r.create({ id: 'abcd', name: 'Server A', hostName: 'Budi', max: 3 }, '1.1.1.1');
  assert.strictEqual(a.id, 'ABCD');
  const l = r.list('online');
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual([l[0].name, l[0].players, l[0].max, l[0].status, l[0].full], ['Server A', 1, 3, 'LOBBY', false]);
  assert.ok(!('token' in l[0]) && !('ip' in l[0]), 'token/ip tidak boleh bocor di daftar');
});

test('validasi: id salah, id kembar, mode salah, nama dibersihkan, max dibatasi 2-4', () => {
  const r = new Registry();
  assert.throws(() => r.create({ id: 'AB1' }), { code: 'bad_id' });
  assert.throws(() => r.create({ id: 'ABCD', mode: 'x' }), { code: 'bad_mode' });
  const a = r.create({ id: 'ABCD', name: '<b>Hai</b>\n  dunia', max: 99 });
  assert.strictEqual(a.name, 'bHai/b dunia'.replace('/b', '/b'));
  assert.strictEqual(a.max, 4);
  assert.throws(() => r.create({ id: 'ABCD' }), { code: 'id_taken' });
  assert.strictEqual(r.create({ id: 'WXYZ', max: 1 }).max, 2);
  // ID sama boleh di mode berbeda (LAN dan ONLINE terpisah)
  assert.ok(r.create({ id: 'ABCD', mode: 'lan' }));
  assert.strictEqual(r.list('lan').length, 1);
  assert.strictEqual(r.list('online').length, 2);
});

test('heartbeat memperbarui pemain/status; token salah ditolak', () => {
  const r = new Registry();
  const a = r.create({ id: 'ABCD', max: 4 });
  r.heartbeat('ABCD', 'online', a.token, { players: 3, status: 'BERMAIN' });
  const x = r.list()[0];
  assert.deepStrictEqual([x.players, x.status], [3, 'BERMAIN']);
  assert.throws(() => r.heartbeat('ABCD', 'online', 'salah', {}), { code: 'bad_token' });
  assert.throws(() => r.heartbeat('ABCD', 'online', a.token, { status: 'HACK' }), { code: 'bad_status' });
  r.heartbeat('ABCD', 'online', a.token, { players: 99 });
  assert.strictEqual(r.list()[0].players, 4);
  assert.strictEqual(r.list()[0].full, true);
});

test('room kedaluwarsa dihapus setelah TTL tanpa heartbeat', () => {
  let t = 1000;
  const r = new Registry({ ttlMs: 25000, now: () => t });
  const a = r.create({ id: 'ABCD' });
  r.create({ id: 'WXYZ' });
  t += 20000;
  r.heartbeat('ABCD', 'online', a.token, {});
  t += 10000; // WXYZ 30s tanpa heartbeat, ABCD 10s
  const l = r.list();
  assert.deepStrictEqual(l.map(x => x.id), ['ABCD']);
});

test('hapus room oleh host dan oleh event disconnect signaling', () => {
  const r = new Registry();
  const a = r.create({ id: 'ABCD' });
  r.create({ id: 'WXYZ' });
  r.create({ id: 'LMNO', mode: 'lan' });
  r.remove('ABCD', 'online', a.token);
  assert.strictEqual(r.removeByPeerId('b14o-wxyz'), true);
  assert.strictEqual(r.removeByPeerId('b14o-wxyz'), false);
  assert.strictEqual(r.removeByPeerId('random-peer'), false);
  assert.strictEqual(r.removeByPeerId('b14l-lmno'), true);
  assert.strictEqual(r.size(), 0);
});

test('batas room per IP dan total', () => {
  const r = new Registry({ maxRooms: 3 });
  for (const id of ['AAAA', 'BBBB', 'CCCC']) r.create({ id }, '9.9.9.9');
  assert.throws(() => r.create({ id: 'DDDD' }, '8.8.8.8'), { code: 'full' });
  const q = new Registry();
  for (const id of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE']) q.create({ id }, '9.9.9.9');
  assert.throws(() => q.create({ id: 'FFFF' }, '9.9.9.9'), { code: 'too_many' });
});

test('validasi silang dengan signaling: room host mati disembunyikan, dihapus setelah masa tenggang, pulih jika host kembali', () => {
  let t = 1000; const alive = new Map();
  const r = new Registry({ ttlMs: 60000, deadGraceMs: 8000, now: () => t, isPeerAlive: id => alive.get(id) });
  const a = r.create({ id: 'ABCD' }); r.create({ id: 'WXYZ' }); r.create({ id: 'LMNO', mode: 'lan' });
  alive.set('b14o-abcd', true); alive.set('b14o-wxyz', true); // b14l-lmno: tidak diketahui -> hanya aturan TTL
  r.heartbeat('ABCD', 'online', a.token, {});
  assert.strictEqual(r.list().length, 3);
  alive.set('b14o-wxyz', false);                  // host WXYZ putus dari signaling
  assert.deepStrictEqual(r.list('online').map(x => x.id), ['ABCD'], 'langsung disembunyikan');
  alive.set('b14o-wxyz', true);                   // gangguan sesaat: host kembali
  t += 3000; r.heartbeat('ABCD', 'online', a.token, {});
  assert.strictEqual(r.list('online').length, 2, 'muncul lagi');
  alive.set('b14o-wxyz', false); r.sweep();       // putus lagi
  t += 9000; r.heartbeat('ABCD', 'online', a.token, {}); r.sweep();
  assert.strictEqual(r.size(), 2, 'dihapus permanen setelah masa tenggang (ABCD & LMNO tersisa)');
  assert.deepStrictEqual(r.list('online').map(x => x.id), ['ABCD']);
  assert.strictEqual(r.list('lan').length, 1, 'peer tak diketahui tidak disembunyikan keliru');
});

test('isPeerAlive yang melempar error tidak merusak daftar', () => {
  const r = new Registry({ isPeerAlive: () => { throw new Error('x'); } });
  r.create({ id: 'ABCD' });
  assert.strictEqual(r.list().length, 1);
});
