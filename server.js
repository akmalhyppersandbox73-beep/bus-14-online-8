'use strict';
// BUS 14 — backend: registry daftar server + signaling PeerJS (WebRTC) + (opsional) static host untuk LAN.
// Jalankan: npm start   (port dari process.env.PORT, default 3000)
const path = require('path');
const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const { Registry } = require('./server/rooms');
const { createHandler } = require('./server/http');
const pkg = require('./package.json');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',');
const TTL = parseInt(process.env.ROOM_TTL_MS, 10) || 20000;

// Pelacak peer yang sedang tersambung ke signaling (dari event 'connection'/'disconnect' PeerServer).
// connected = sedang online; seen = pernah terlihat. Peer yang pernah terlihat lalu putus dianggap MATI;
// peer yang tidak pernah terlihat = tidak diketahui (jatuh ke aturan TTL), agar tidak salah menyembunyikan room.
const connected = new Set();
const seen = new Set();
const isPeerAlive = id => (connected.has(id) ? true : seen.has(id) ? false : undefined);

const registry = new Registry({ ttlMs: TTL, isPeerAlive, deadGraceMs: parseInt(process.env.ROOM_DEAD_GRACE_MS, 10) || 8000 });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// /health dan /api/rooms (lihat server/http.js)
app.use(createHandler(registry, { allowedOrigins: ALLOWED, version: pkg.version }));

// Frontend statis (berguna untuk LAN: buka http://IP-LAPTOP:3000). Hanya file game yang dibuka, bukan seluruh folder.
const ROOT = __dirname;
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/config.js', (req, res) => res.sendFile(path.join(ROOT, 'config.js')));

const server = http.createServer(app);

// Signaling PeerJS di /peerjs  (WebSocket upgrade ditangani oleh peer)
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,            // di belakang reverse proxy (Suga) -> hormati X-Forwarded-*
  alive_timeout: 20000,     // koneksi signaling tanpa aktivitas > 20 dtk dianggap putus (default PeerJS 60 dtk)
  allow_discovery: false,   // jangan bocorkan daftar peer; daftar room lewat /api/rooms
  corsOptions: { origin: ALLOWED.includes('*') ? true : ALLOWED },
});
app.use('/peerjs', peerServer);

peerServer.on('connection', client => {
  const id = client && client.getId && client.getId();
  if (id) { connected.add(id); seen.add(id); registry.sweep(); }
});
// Host terputus dari signaling -> room langsung disembunyikan dari daftar dan dihapus setelah masa tenggang
// (memberi waktu bila hanya gangguan sinyal sesaat; host yang kembali akan muncul lagi).
peerServer.on('disconnect', client => {
  const id = client && client.getId && client.getId();
  if (!id) return;
  connected.delete(id);
  registry.sweep();
  if (/^b14[ol]-/.test(id)) console.log('[room] peer host terputus dari signaling:', id);
});

app.use((req, res) => res.status(404).json({ error: 'Tidak ditemukan.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[express] error:', err && err.message);
  res.status(500).json({ error: 'Kesalahan server.' });
});

const sweeper = setInterval(() => {
  const n = registry.sweep();
  if (n) console.log('[room] dibersihkan (kedaluwarsa/host mati):', n);
  // bersihkan catatan peer lama agar Set tidak membesar tanpa batas
  if (seen.size > 5000) { for (const id of seen) if (!connected.has(id)) seen.delete(id); }
}, 2000);
sweeper.unref();

server.listen(PORT, HOST, () => {
  console.log(`BUS 14 server berjalan di http://${HOST}:${PORT}  (health: /health, daftar: /api/rooms, signaling: /peerjs)`);
});

function shutdown(sig) {
  console.log(sig + ' diterima, menutup server...');
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
