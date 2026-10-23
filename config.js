// ============================================================
//  BUS 14 — KONFIGURASI (aman dipublikasikan; JANGAN taruh secret/password di sini)
//  Ganti semua "link kamu" setelah backend kamu ter-deploy.
//  File ini ikut diunggah ke itch.io bersama index.html.
// ============================================================
window.GAME_CONFIG = {
  // URL publik backend (Suga), lengkap dengan https://, tanpa garis miring di akhir.
  // Dipakai untuk cek /health (status ONLINE/OFFLINE + ping).
  // Contoh bentuk: "https://nama-app-kamu.contoh.app"
  SERVER_URL: "https://2xegdj8hwf6i-production-ssrr31ci.us-central1.suga.run",

  // URL dasar API daftar server/room. Biasanya = SERVER_URL + "/api".
  // Contoh bentuk: "https://nama-app-kamu.contoh.app/api"
  // (Boleh dikosongkan "" agar otomatis memakai SERVER_URL + "/api".)
  API_BASE_URL: "https://2xegdj8hwf6i-production-ssrr31ci.us-central1.suga.run/api",

  // Server signaling PeerJS: HANYA nama host (tanpa https://, tanpa path).
  // Contoh bentuk: "nama-app-kamu.contoh.app"
  // Dengan server.js bawaan, signaling berjalan di server yang sama dengan backend.
  PEERJS_HOST: "2xegdj8hwf6i-production-ssrr31ci.us-central1.suga.run",
  PEERJS_PORT: 443,
  PEERJS_SECURE: true,

  // Path signaling PeerJS. server.js bawaan memakainya di "/peerjs". Ubah hanya jika kamu memakai signaling lain.
  PEERJS_PATH: "/peerjs",

  // OPSIONAL: server TURN agar pemain dengan NAT ketat / jaringan seluler bisa terhubung.
  // Contoh: [{ urls: "turn:turn.contoh.com:3478", username: "user", credential: "pass" }]
  // PERINGATAN: isi file ini publik. Pakai kredensial TURN sementara/terbatas, bukan akun utama.
  ICE_SERVERS: []
};
