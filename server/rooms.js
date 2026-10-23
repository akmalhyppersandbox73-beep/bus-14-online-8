'use strict';
// Registry room in-memory. Tanpa dependensi, mudah diuji.
// Registry HANYA menyimpan metadata (nama, jumlah pemain, status). Data gameplay tidak lewat sini: itu P2P (WebRTC).
const crypto = require('crypto');

const ID_RE = /^[A-Z]{4}$/;
const MODES = ['online', 'lan'];
const STATUSES = ['LOBBY', 'BERMAIN'];

function cleanText(v, max, fallback) {
  const s = String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s || fallback;
}

// Nama pemain/host: aturan SAMA dengan cleanName() di index.html (huruf, angka, spasi, _ . ' -; maks 16 karakter; kosong -> 'Pemain'),
// sehingga nama host di daftar server identik dengan nama di lobi.
const NAME_MAX = 16, NAME_DEF = 'Pemain';
function cleanName(v, fb) {
  let s;
  try { s = String(v == null ? '' : v); } catch (e) { s = ''; }
  try { s = s.normalize('NFC'); } catch (e) { /* abaikan */ }
  s = s.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/ {2,}/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  return s || (fb === undefined ? NAME_DEF : fb);
}

// Status "sembunyikan dari list server": hanya boolean sungguhan (true/false). Nilai lain ditolak agar tidak ambigu.
function parseHidden(v) {
  if (v === true || v === false) return v;
  throw new RoomError(400, 'bad_hidden', 'Nilai hidden harus true atau false.');
}

class RoomError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class Registry {
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs || 20000;      // room dihapus bila tidak ada heartbeat selama ini
    // Validasi silang dengan signaling: isPeerAlive(peerId) -> true | false | undefined (tidak diketahui).
    // Room yang peer host-nya terbukti putus disembunyikan dari daftar seketika dan dihapus setelah deadGraceMs.
    this.isPeerAlive = typeof opts.isPeerAlive === 'function' ? opts.isPeerAlive : null;
    this.deadGraceMs = opts.deadGraceMs == null ? 8000 : opts.deadGraceMs;
    this.maxRooms = opts.maxRooms || 300;
    this.now = opts.now || (() => Date.now());
    this.rooms = new Map();
  }

  create(input, ip) {
    input = input || {};
    const id = String(input.id || '').toUpperCase();
    if (!ID_RE.test(id)) throw new RoomError(400, 'bad_id', 'ID room harus 4 huruf A-Z.');
    const mode = input.mode == null ? 'online' : input.mode;
    if (!MODES.includes(mode)) throw new RoomError(400, 'bad_mode', 'Mode tidak valid.');
    const max = Math.min(4, Math.max(2, parseInt(input.max, 10) || 4));
    const hidden = input.hidden == null ? false : parseHidden(input.hidden);
    const hostName = cleanName(input.hostName);
    const name = cleanText(input.name, 24, 'Server ' + hostName);
    this.sweep();
    if (this.rooms.has(id + ':' + mode)) throw new RoomError(409, 'id_taken', 'ID room sudah dipakai.');
    if (this.rooms.size >= this.maxRooms) throw new RoomError(503, 'full', 'Server penuh, coba lagi nanti.');
    if (ip && this._countByIp(ip) >= 5) throw new RoomError(429, 'too_many', 'Terlalu banyak room dari alamat ini.');
    const t = this.now();
    const room = {
      id, mode, name, hostName, max,
      players: 1, status: 'LOBBY',
      hidden,                           // true = tidak tampil di GET /api/rooms (tetap bisa dimasuki lewat Room ID / PeerJS)
      token: crypto.randomBytes(16).toString('hex'),
      ip: ip || null, createdAt: t, updatedAt: t,
    };
    this.rooms.set(id + ':' + mode, room);
    return room;
  }

  _countByIp(ip) {
    let n = 0;
    for (const r of this.rooms.values()) if (r.ip === ip) n++;
    return n;
  }

  _auth(id, mode, token) {
    const r = this.rooms.get(String(id).toUpperCase() + ':' + mode);
    if (!r) throw new RoomError(404, 'not_found', 'Room tidak ditemukan.');
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(r.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new RoomError(403, 'bad_token', 'Token tidak valid.');
    return r;
  }

  heartbeat(id, mode, token, data) {
    const r = this._auth(id, mode, token);
    data = data || {};
    if (data.players != null) r.players = Math.min(r.max, Math.max(1, parseInt(data.players, 10) || 1));
    if (data.status != null) {
      if (!STATUSES.includes(data.status)) throw new RoomError(400, 'bad_status', 'Status tidak valid.');
      r.status = data.status;
    }
    // Ubah status tersembunyi saat room berjalan: hanya memperbarui metadata registry (tidak menyentuh koneksi P2P pemain).
    if (data.hidden != null) r.hidden = parseHidden(data.hidden);
    r.updatedAt = this.now();
    return r;
  }

  remove(id, mode, token) {
    const r = this._auth(id, mode, token);
    this.rooms.delete(r.id + ':' + r.mode);
    return true;
  }

  // dipakai saat PeerServer melaporkan peer host terputus (tanpa token)
  removeByPeerId(peerId) {
    const m = /^b14([ol])-([a-z]{4})$/.exec(String(peerId));
    if (!m) return false;
    return this.rooms.delete(m[2].toUpperCase() + ':' + (m[1] === 'o' ? 'online' : 'lan'));
  }

  static peerIdOf(r) { return 'b14' + (r.mode === 'lan' ? 'l' : 'o') + '-' + r.id.toLowerCase(); }

  sweep() {
    const t = this.now();
    let n = 0;
    for (const [k, r] of this.rooms) {
      if (t - r.updatedAt > this.ttlMs) { this.rooms.delete(k); n++; continue; }
      if (this.isPeerAlive) {
        let alive;
        try { alive = this.isPeerAlive(Registry.peerIdOf(r)); } catch (e) { alive = undefined; }
        if (alive === false) {
          if (!r.deadSince) r.deadSince = t;
          else if (t - r.deadSince > this.deadGraceMs) { this.rooms.delete(k); n++; }
        } else if (alive === true) r.deadSince = 0;
      }
    }
    return n;
  }

  list(mode) {
    this.sweep();
    const t = this.now();
    return [...this.rooms.values()]
      .filter(r => (!mode || r.mode === mode) && !r.deadSince && !r.hidden) // room tersembunyi TIDAK PERNAH keluar dari server
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(r => ({
        id: r.id, name: r.name, hostName: r.hostName, mode: r.mode,
        players: r.players, max: r.max, status: r.status,
        full: r.players >= r.max, ageSec: Math.round((t - r.createdAt) / 1000),
      }));
  }

  size() { return this.rooms.size; }

  // jumlah room publik saja (dipakai /health agar jumlah room tersembunyi tidak bocor)
  publicSize() {
    let n = 0;
    for (const r of this.rooms.values()) if (!r.hidden && !r.deadSince) n++;
    return n;
  }
}

module.exports = { Registry, RoomError, cleanText, cleanName };
