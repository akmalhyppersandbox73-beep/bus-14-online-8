# BUS 14 — Multiplayer LAN + Online

Game horor bus 3D (Three.js) dengan dua mode multiplayer:

- **MULTIPLAYER LAN** – bermain bersama dengan kode room (4 huruf), tanpa server sendiri.
- **MULTIPLAYER ONLINE** – daftar server nyata dari backend; pilih server lalu GABUNG, atau pakai Room ID.

Gameplay singleplayer, kustomisasi, chat, kontrol HP/PC tidak diubah.

---

## 1. Cara kerja (3 bagian, jangan tertukar)

| Bagian | Tugas | Di mana |
|---|---|---|
| **Frontend** (`index.html` + `config.js`) | Game itu sendiri | itch.io (atau server.js untuk LAN) |
| **Backend registry** (`/api/rooms`, `/health`) | Menyimpan *daftar* server: nama, jumlah pemain, status. **Tidak** membawa data gameplay. | Suga (`server.js`) |
| **Signaling PeerJS** (`/peerjs`) | “Perkenalan” antar pemain agar WebRTC bisa tersambung. Setelah itu data gameplay lewat **P2P** antar-browser. | Suga (`server.js`, proses yang sama) |

Topologi P2P: **bintang**. Pembuat room = **host** (otoritas gameplay: pemungutan suara, mulai game, pemilihan anomali via seed). Pemain lain terhubung ke host; host merelay pesan dan daftar pemain.

Alur ONLINE: host membuat peer `b14o-KODE` di signaling → mendaftarkan room ke `/api/rooms` → mengirim heartbeat tiap ±8 dtk (jumlah pemain, status LOBBY/BERMAIN). Room dihapus dari daftar jika: host keluar, signaling melaporkan host putus, atau tidak ada heartbeat 20 dtk, atau peer signaling host terbukti putus (lihat bagian 2b).

---

## 2. Menjalankan di komputer sendiri

```bash
npm install
npm start          # http://localhost:3000  (port dari process.env.PORT, default 3000)
```

- Cek: `http://localhost:3000/health` → `{"ok":true,"app":"bus14-server",...}` dan `http://localhost:3000/api/rooms`.
- Jalankan tes: `npm test`.
- Server mengikat `0.0.0.0` (ubah dengan env `HOST`).

### LAN dengan server lokal (opsional, paling andal)
1. Satu orang menjalankan `npm start` di laptop.
2. Semua pemain di Wi-Fi yang sama membuka `http://IP-LAPTOP:3000` (mis. `http://192.168.1.5:3000`).
3. Di **MULTIPLAYER LAN** game otomatis mendeteksi server lokal itu: sesi LAN tampil sebagai daftar dan signaling memakai laptop tersebut.
4. Pemain yang membuka game dari tempat lain bisa mengisi kolom **SERVER LAN LOKAL** dengan `192.168.1.5:3000`. (Halaman `https://` tidak boleh memanggil alamat `http://` — pembatasan browser; buka game via `http://` di LAN.)

### LAN tanpa server sendiri
Pembuat room menekan **BUAT ROOM**, lalu memberi 4 huruf ID ke teman → teman mengisi ID → **GABUNG ROOM**. Browser **tidak bisa** menemukan perangkat LAN otomatis, jadi tidak ada penemuan otomatis di mode ini. Signaling memakai server publik PeerJS bawaan (butuh internet ringan untuk “perkenalan”); data gameplay tetap P2P.

---

## 2b. Aturan host & guest (ONLINE: host putus = sesi berakhir; LAN: lihat 2e — host pindah)

> **Catatan:** isi bagian 2b di bawah tetap berlaku penuh untuk **Multiplayer ONLINE**. Untuk **Multiplayer LAN**, poin "host putus = sesi berakhir" dan "tidak ada pengangkatan host" sudah **digantikan oleh HOST MIGRATION** (bagian 2e). Aturan guest-tidak-bisa-keluar, `bye`, heartbeat, dan masa tenggang tetap dipakai sebagai pendeteksi.

- **Host** = pemilik room dan pengendali sesi. **Guest tidak bisa keluar sendiri selama game berjalan**: di menu jeda tombolnya berubah menjadi "KELUAR DIKUNCI (HANYA HOST)" dan klik apa pun hanya menampilkan petunjuk. Guest tetap keluar lewat alur game yang sudah ada (perjalanan selesai). Di **lobi sebelum game dimulai** guest masih boleh kembali; untuk mengunci lobi juga, ubah `GUEST_LOCK_LOBBY=false` menjadi `true` di blok `HOSTGUARD` pada `index.html`. Browser/tab/perangkat tidak dikunci: menutup tab selalu bisa, dan akan dianggap guest keluar.
- Host yang menekan keluar (ada konfirmasi dua langkah, tombol "AKHIRI SESI") mengirim pesan **`bye`** ke semua guest. Penutupan tab mengirim `bye` sebisanya (browser tidak menjamin pesan terkirim).
- Deteksi tanpa `bye` (crash, internet putus): host mengirim heartbeat tiap 3 dtk. Guest yang tidak menerima apa pun **8 dtk** (atau koneksi menutup) masuk status **menyambung ulang** (banner di atas layar) selama **10 dtk**, mencoba menyambung lagi tiap 2 dtk. Jika host kembali dalam masa itu, game berlanjut. Jika tidak, tampil layar **"HOST TERPUTUS — Sesi permainan berakhir"** dan setelah 6 dtk (atau tombol KEMBALI SEKARANG) semua guest kembali ke lobby (daftar server / layar LAN).
- Sebaliknya, host menahan slot guest yang putus selama **12 dtk** (ditandai "menyambung ulang…"); guest yang kembali tepat waktu diterima lagi dengan token sesi miliknya, yang lebih lama dihapus dan menerima akhir sesi.
- **Tidak ada pengangkatan host.** Guest tidak pernah otomatis menjadi host; room mati bersama host. Guest tidak bisa mengubah status host dari client (flag `host`, kapasitas, dan nama server hanya dari host; ID sesi dan token sambung-ulang dicek).
- **Server (ONLINE & LAN-server-lokal):** room dihapus saat host keluar (DELETE/beacon), saat heartbeat berhenti 20 dtk, dan saat signaling PeerJS melaporkan peer host putus (langsung disembunyikan dari daftar, dihapus permanen setelah masa tenggang). Room yang pernah terlihat di signaling lalu putus dianggap mati; peer yang tidak pernah terlihat hanya tunduk pada aturan heartbeat.
- **LAN tanpa server lokal** tidak punya registry; semua deteksi di atas berjalan murni P2P (`bye` + heartbeat + masa tenggang).

---

## 2c. Sembunyikan Room dari List Server (fitur baru)

Host ONLINE bisa membuat room yang **tidak tampil** di daftar server publik maupun kotak CARI SERVER, tetapi tetap bisa dimasuki lewat **Room ID** (kolom ID + tombol GABUNG ID).

- **Saat membuat room:** BUAT SERVER → centang **Sembunyikan Room dari List Server** → BUAT. Room terdaftar sebagai tersembunyi sejak registrasi pertama (tidak sempat tampil sesaat).
- **Saat room berjalan:** host punya checkbox yang sama di layar lobi dan di menu JEDA. Mengubahnya memperbarui registry lewat `PUT /api/rooms/:id` (`hidden: true/false`, wajib token host). Koneksi P2P pemain yang sudah bergabung tidak disentuh.
- **Diterapkan di server:** `GET /api/rooms` tidak pernah mengirim room tersembunyi (filter di `server/rooms.js`, bukan di tampilan klien). `/health` hanya menghitung room publik. Tidak ada endpoint pencarian per-ID.
- **Room ID & join tidak berubah:** join memakai ID peer PeerJS (`b14o-XXXX`) langsung lewat signaling, tidak lewat daftar. Room tersembunyi tetap memakai slot ID, TTL, heartbeat, dan pembersihan host-mati yang sama.
- **Tidak memakai kata sandi.** Ini hanya "tidak dicantumkan", bukan keamanan: siapa pun yang tahu Room ID (4 huruf) tetap bisa masuk.
- API: `POST /api/rooms` menerima `hidden` (boolean, default `false`); nilai non-boolean ditolak 400 `bad_hidden`. Hanya mode ONLINE yang punya checkbox di UI; LAN tidak berubah.

**Cara menguji manual:** (1) Perangkat A: ONLINE → BUAT SERVER → centang → BUAT. (2) Perangkat B: ONLINE → REFRESH dan cari nama server: tidak muncul. (3) B isi Room ID dari A → GABUNG ID: masuk lobi, READY, MULAI, main bersama. (4) Di A (lobi atau menu JEDA) hilangkan centang: dalam ±6 dtk perangkat C melihat room di daftar (status BERMAIN, tidak bisa gabung lewat tombol), A dan B tidak terputus. (5) Centang lagi: room hilang dari daftar, permainan jalan terus. (6) Buat room kedua tanpa centang: tampil normal.

---

## 2d. Kick Player (fitur baru)

Host bisa mengeluarkan guest dari lobi online/LAN langsung di dalam game.

- **UI:** di daftar pemain lobi, host melihat tombol **KICK** pada setiap pemain lain (tidak pada dirinya). Guest tidak melihat tombol apa pun. Klik KICK -> dialog konfirmasi **di dalam game** (bukan `window.confirm`) -> YA — KELUARKAN.
- **Efek:** guest yang di-kick menerima pesan `kick`, langsung terputus, melihat layar "DIKELUARKAN — Kamu dikeluarkan oleh host", lalu kembali ke menu multiplayer dengan notifikasi. Pemain lain melihat daftar pemain terbaru, dan slot kosong lagi (jumlah pemain di registry ikut turun lewat heartbeat).
- **Siapa yang menegakkan:** karena data room berjalan P2P (host = otoritas), validasi ada di kode host (`R.kick` di `mkRoom`): hanya host, target harus anggota room dan bukan host sendiri, ID bukan-string/tak dikenal ditolak. Pesan `kick` palsu dari guest tidak pernah diproses (host hanya menerima `hi/p/e/bye/ping`), dan guest tidak bisa mengirim `kick` ke guest lain karena semua koneksi guest hanya ke host. Server Suga (registry + signaling) tidak melihat data room, jadi **server tidak berubah**.
- **Anti-masuk lagi:** ID peer dan token sambung-ulang pemain yang di-kick dimasukkan daftar blokir selama room itu hidup; percobaan menyambung dengan identitas lama ditolak (`kicked`). Blokir hanya berlaku di room itu (room lain tidak terpengaruh) dan hilang saat room ditutup.
- **Batasan jujur:** tidak ada akun/IP, jadi pemain yang menutup game lalu membuka sesi join **baru** (peer baru) tetap bisa masuk lagi selama room belum penuh/mulai. Ini sesuai kebijakan "sesi join baru". Host bisa meng-kick lagi bila perlu.

**Cara menguji Kick di Multiplayer LAN (manual, 2–3 perangkat satu Wi-Fi):**
1. Jalankan `npm start` di satu PC. Buka `http://IP-PC:3000` di Perangkat A, B, dan C (opsional).
2. A: MULTIPLAYER LAN → buat room. B dan C: GABUNG ID dengan Room ID dari A.
3. Di A hanya host yang melihat tombol **KICK** di samping nama B dan C; di B dan C tidak ada tombol.
4. A klik KICK pada B → dialog konfirmasi muncul di dalam game → BATAL: tidak terjadi apa-apa; ulangi lalu YA — KELUARKAN.
5. B melihat layar "DIKELUARKAN" lalu kembali ke menu LAN; daftar pemain di A dan C langsung berkurang satu.
6. B mencoba menyambung lagi dengan sesi lama: ditolak. C tetap terhubung dan bisa READY/MULAI seperti biasa.

## 2e. HOST MIGRATION — khusus Multiplayer LAN (fitur baru)

Jika host LAN keluar, menutup game, atau koneksinya putus, **guest tidak ikut keluar**. Guest yang masih aktif tetap di lobi/gameplay yang sama, lalu **satu guest dipilih acak** menjadi host baru. **Multiplayer ONLINE tidak berubah sama sekali** (diaktifkan hanya bila `net.mig` diberikan, dan `mpJoin` hanya memberikannya untuk `net=='lan'`).

### Cara kerja (semua di `mkRoom` di `index.html`; tanpa server/halaman/iframe baru)
1. **Tautan antar-guest.** Selain koneksi ke host (bintang), setiap guest LAN membuka koneksi data langsung ke guest lain (maks 3 tautan, hanya untuk pesan kontrol pemilihan; gameplay tetap lewat host). Daftar guest berasal dari roster host.
2. **Deteksi host hilang.** Host kirim `bye` saat keluar (langsung memulai pemilihan) atau heartbeat berhenti. Tanpa `bye`: diam 8 dtk, lalu **masa tenggang 5 dtk** menyambung ulang ke host (pada ONLINE tetap 10 dtk). Gangguan sesaat yang pulih dalam masa itu tidak memicu pergantian host.
3. **Pemilihan terkoordinasi (satu koordinator, dua fase).** Koordinator = guest aktif ber-ID peer terkecil (ID peer stabil selama sesi). Fase 1 `prep(term)`: tiap guest menjawab `ack` hanya bila ia juga menganggap host hilang dan hanya ke **satu** koordinator per `term` (janji). Guest yang masih menerima heartbeat host membalas `hostok` sehingga **guest yang terisolasi sendirian tidak bisa merebut host** dari host yang sehat. Fase 2: koordinator memilih **satu pemenang acak** (`crypto.getRandomValues`) hanya dari yang benar-benar menjawab `ack` (jadi yang sudah terputus tidak mungkin terpilih), lalu mengirim `commit` berisi pemenang, ID sesi baru, dan daftar anggota. Semua guest menerapkan hasil yang sama → hanya satu host.
4. **Pemulihan.** Koordinator mati → guest lain menunggu 5 dtk lalu menganggapnya mati dan memilih ulang (`term` naik). Pemenang mati sebelum/sesudah `commit` → guest tidak berhasil menyambung dalam 5 dtk → pemilihan diulang tanpa pemenang itu. Host baru juga keluar → proses sama berulang untuk guest yang tersisa. Guest yang tidak sempat menerima `commit` diberi tahu host baru oleh guest lain (`nack` berisi `term/host/sid`) dan diterima kembali sebagai mantan anggota. Tersisa satu guest → ia langsung jadi host (room tidak ditutup). Tidak ada guest sama sekali → room selesai dengan sendirinya.
5. **Serah-terima host.** Pemenang: `S.host=1`, membangun ulang roster dari anggota pemilihan (token sambung-ulang tiap guest dikirim lewat `ack`), mewarisi kapasitas, nama server, dan daftar blokir kick. Guest menyambung ke host baru dengan token miliknya. **Posisi, scene, ready, nama, kustomisasi** tiap pemain dibawa oleh pemain itu sendiri (presence), sehingga tidak hilang. Pemenang juga mencoba mengklaim ulang **Room ID asli** (peer `b14l-KODE`) agar pemain baru di lobi tetap bisa bergabung dengan kode yang sama (ID itu baru bebas setelah signaling melepas host lama, dicoba tiap 4 dtk). Bila ada server LAN lokal, host baru mendaftarkan ulang room ke `/api/rooms` (menunggu entri lama kedaluwarsa, maks ±40 dtk).
6. **Gameplay.** Voting yang sedang berjalan di host lama dibatalkan (pemain bisa mengulang). Bila host lama mati tepat saat pintu bus terbuka sebelum mengirim `board`, host baru mengirimnya; guest yang tertinggal di terminal diajak masuk bus lewat pesan `sync`. Fitur kick, chat, vote, ready, dan jumlah pemain tetap bekerja lewat host baru.
7. **UI.** Banner "Host terputus — memilih host baru…", lalu "Host baru terpilih — menyambungkan…", lalu notifikasi: "Host lama (NAMA) terputus. NAMA kini menjadi host." (untuk host baru: "Kamu sekarang menjadi host."). Di menu jeda, host LAN melihat "KELUAR (HOST PINDAH)" dan konfirmasi "YAKIN? HOST PINDAH KE PEMAIN LAIN". Guest tetap tidak bisa keluar sendiri saat game berjalan.

### Perlu update backend?
**Tidak.** `server.js`, `server/*`, `config.js`, dan `package.json` tidak diubah. Protokol berjalan P2P; server hanya dipakai sebagai signaling seperti biasa. (Dengan server LAN lokal, host baru memakai endpoint `/api/rooms` yang sudah ada.)

### Cara menguji manual (2+ perangkat, satu Wi-Fi)
Jalankan `npm start` di satu PC; buka `http://IP-PC:3000` di Perangkat A, B, C (C opsional). Pakai MULTIPLAYER LAN di semuanya.
1. **Host keluar di lobi:** A buat room, B & C GABUNG ID. Di A tekan JEDA/KEMBALI → keluar (konfirmasi dua langkah). B & C tetap di lobi; muncul notifikasi; salah satunya melihat tombol MULAI/KICK (host baru). Daftar pemain sama di semua layar dan hanya satu "★ HOST".
2. **Host keluar saat gameplay:** mulai game (semua READY → MULAI), masuk bus. A keluar lewat JEDA. B & C tetap bermain di terminal/bus yang sama, posisi pemain lain masih terlihat, chat dan voting (E → vote) berjalan; host baru bisa mengakhiri lewat JEDA.
3. **Koneksi host putus mendadak:** saat A host, cabut Wi-Fi A / matikan paksa tab A (tanpa tombol keluar). Setelah ±13 dtk (8 dtk hening + 5 dtk tenggang) B & C otomatis memilih host baru. Jangan klik apa-apa: tidak ada yang kembali ke menu.
4. **Calon host baru terputus saat migrasi:** ulangi langkah 3 dengan 3 guest (A host + B, C, D). Begitu notifikasi host baru muncul (atau bahkan segera setelah A mati), matikan perangkat yang jadi host baru; pemilihan akan berulang di antara sisanya (±5 dtk).
5. **Hanya satu guest tersisa:** A host + B saja; A keluar → B jadi host, room tetap ada di lobi ("Menunggu minimal 2 pemain...").
6. **Bergabung dengan Room ID lama setelah migrasi (lobi):** setelah langkah 1, perangkat D GABUNG ID yang sama; berhasil setelah beberapa detik (ID dilepas signaling). Pada kasus host mati mendadak, signaling publik bisa menahan ID lama hingga ±1 menit.
7. **Kick setelah migrasi:** host baru KICK salah satu pemain; pemain itu tidak bisa masuk lagi dengan koneksi lama.
8. **ONLINE tidak berubah:** buat server ONLINE, host keluar → guest melihat "HOST TERPUTUS — Sesi permainan berakhir" seperti sebelumnya.

### Batasan jujur
- **Tidak ada "quorum":** pemain dianggap aktif bila tautan langsungnya hidup. Bila jaringan benar-benar terbelah (A–B tidak bisa saling bicara padahal keduanya hidup), tiap kubu bisa memilih host sendiri (dua room terpisah). Pada satu Wi-Fi hal ini jarang; bila tautan antar-guest belum sempat terbentuk, guest menunggu ±4 dtk untuk mencoba menyambung ke semua anggota sebelum memutuskan sendirian.
- Jika host lama **sebenarnya hidup tetapi terputus > ±13 dtk**, ia dianggap mati; saat kembali ia menjadi room terpisah sendirian (tidak akan menggabung otomatis).
- Pesan yang sedang terkirim tepat saat host mati bisa hilang (mis. hasil voting). Voting dibatalkan dan bisa diulang; progres bus/terminal, posisi, dan pemain dipertahankan.
- Setelah migrasi, waktu bermain di dalam bus tetap berjalan lokal di tiap klien (seperti sebelumnya); tidak ada snapshot dunia karena game tidak punya state dunia terpusat selain voting dan seed anomali.
- Migrasi memakai koneksi WebRTC antar-guest; jaringan yang memblokir koneksi antar-klien (client isolation pada sebagian Wi-Fi tamu) tidak bisa memakai LAN P2P sejak awal.

## 2f. Guest ONLINE & LAN keluar sendiri dari room (BARU)

Di **Multiplayer ONLINE dan LAN**: guest boleh keluar kapan saja (di lobi maupun saat game berjalan), tanpa menunggu host. Di LAN, guest yang keluar tidak memicu pemilihan host baru; host migration hanya berjalan bila **host** yang hilang.

- **UI:** di lobi tombol `KEMBALI` berubah menjadi `KELUAR DARI ROOM`; saat game, menu JEDA (ESC) menampilkan `KELUAR DARI ROOM`. Keduanya membuka dialog konfirmasi (`KELUAR DARI ROOM?` → `YA — KELUAR` / `BATAL`). Setelah `YA`, guest kembali ke layar Multiplayer-nya (ONLINE: daftar server; LAN: layar LAN).
- **Protokol:** guest mengirim `bye` ke host lalu menutup peer & semua koneksinya (`RM.leave()`). Host hanya menghapus **pengirim pesan itu sendiri** (pemain dicari dari ID koneksi, bukan dari isi pesan), sehingga guest tidak bisa mengeluarkan orang lain. `kick` tetap hanya bisa dilakukan host. `bye` kini diproses sebelum pembatas laju agar tidak berubah menjadi "ghost" (status AWAY 12 dtk).
- **Game tidak macet:** suara voting (keluar/jalan bus) dari pemain yang keluar dibuang; total pemain dan tampilan vote diperbarui, dan voting selesai otomatis bila semua pemain yang tersisa sudah memilih.
- **Daftar server:** jumlah pemain di registry diperbarui segera (ada pembaruan susulan bila tertahan pembatas laju 1,5 dtk). Room tidak dihapus/ditutup ketika guest keluar; hanya host (pemegang token) yang bisa mengubah registry.
- **Bergabung lagi:** guest yang keluar bisa masuk lagi selama room masih tersedia (status LOBBY & belum penuh). Room yang sudah BERMAIN tetap menolak pemain baru (`started`), sama seperti sebelumnya.
- **Uji:** `test/guestleave.test.js` (skenario A–D, keamanan, voting, registry); LAN/host migration tetap diuji oleh `test/migration.test.js` dan `test/migui.test.js`. Jalankan `npm test`.

## 2g. Nama Custom Pemain (BARU)

Pemain bisa menulis **nama sendiri** sebelum membuat/bergabung ke room — di layar **MULTIPLAYER ONLINE**, layar **MULTIPLAYER LAN**, dan di **Pengaturan → Nama** (ketiga kolom saling terhubung).

- **Aturan nama:** maksimal 16 karakter; hanya huruf (termasuk aksen/aksara lain), angka, spasi, `_` `.` `'` `-`; karakter lain (`<` `>`, tanda kurung, simbol, karakter kontrol) dibuang; spasi dirapikan; **kosong → `Pemain`**. Nama disimpan di `localStorage` (`b14cz`) sehingga bertahan selama sesi dan saat game dimuat ulang. Nama awal (sebelum pernah diubah) tetap nama acak bawaan dari daftar lama.
- **Alur nama:** kolom input → `C.name` (`pnSet`/`pnCommit` dipanggil lagi di awal `mpJoin`, jadi nama di kolom pasti yang dikirim) → presence `name` di `init` → host membersihkan lagi dengan `cleanName()` di `cl()` → host menyiarkan daftar pemain → tiap klien menampilkan lewat `nm()`/`recName()` per **ID pemain** (bukan nama host) di lobi, dialog kick, chat, dan notifikasi.
- **Host selalu menegakkan aturan**, bukan hanya input: nama dari klien yang dimodifikasi tetap dibersihkan; guest tanpa nama → `Pemain`; pembaruan presence yang namanya kosong/tidak valid **tidak menimpa** nama lama; guest hanya bisa mengubah entri dirinya sendiri.
- **Nama kembar** otomatis diberi akhiran `(1)`, `(2)` secara deterministik (urutan waktu masuk, lalu ID) — sama di semua klien. Tanda kurung dilarang di input sehingga pemain tidak bisa meniru akhiran/label sistem.
- **Reconnect:** guest yang menyambung ulang memakai slot & presence lama di host, jadi namanya tidak berubah/tertukar. LAN host migration membawa nama setiap pemain lewat `cl()`.
- **Daftar server:** `hostName` di registry = nama host custom (dibersihkan dengan aturan yang sama di `server/rooms.js`, fungsi `cleanName`). Nama server **bawaan** = `Server <nama host>` dan ikut berubah bila nama diganti; **nama server kustom yang kamu ketik tidak pernah ditimpa**. Pendaftaran ulang registry memakai `hostName` yang disimpan saat room dibuat.
- **Uji:** `test/playername.test.js` (lihat bagian 8). Backend (`server.js`, `config.js`, port Suga) tidak berubah; di `server/rooms.js` hanya `hostName` yang kini memakai `cleanName`.

## 2h. Layout Multiplayer Online di HP landscape (PERBAIKAN)
Masalah: di HP landscape pendek (tinggi ≤ ±400px) isi menu lebih tinggi dari layar, sehingga kotak daftar server (`#olist`) ikut "diperas" flexbox sampai tinggi 0 dan daftar tidak terlihat.
Perbaikan (hanya HTML/CSS di `index.html`; logika server, Room ID, PeerJS, join, LAN tidak disentuh):
- `.rl` (kotak daftar) sekarang `flex:none` + `overflow-x:hidden`, jadi tidak bisa menyusut ke 0 dan hanya scroll vertikal.
- `@media(orientation:landscape) and (max-height:540px)`: menu online jadi 2 kolom setinggi `100dvh` — kiri: nama, cari, REFRESH, BUAT SERVER, GABUNG ID (kolom ini bisa di-scroll saat form BUAT SERVER dibuka); kanan: daftar server yang mengisi tinggi layar dan scroll vertikal. Memakai safe-area (notch) kiri/kanan/atas/bawah.
- Portrait HP (≤600px): layout tetap satu kolom + tulisan saran memutar ke landscape (CSS saja, tanpa Screen Orientation API); lebar daftar dibatasi agar tidak ada scroll horizontal.
- PC/tablet: tampilan tidak berubah. Markup hanya dibungkus `div.mob > div.mos` (ID elemen sama); di luar landscape pendek keduanya `display:contents`.
- Uji otomatis (opsional): `python3 tools/e2e-lokal/landscape-online.py` (butuh Playwright Python; PeerJS/Three di-stub, server dipalsukan lewat route).

## 3. Deploy backend: GitHub → Suga

> Catatan jujur: saya **tidak punya akses** ke akun GitHub/Suga kamu dan **tidak menemukan dokumentasi resmi Suga** saat menyusun ini, jadi langkah di bawah bersifat umum untuk platform Node.js. Nama menu bisa berbeda — ikuti dashboard Suga.

1. Buat repository GitHub baru, lalu unggah **seluruh isi folder ini** (`.gitignore` sudah menolak `node_modules`).
   ```bash
   git init && git add . && git commit -m "BUS 14 online"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```
2. Di Suga: buat proyek/layanan baru dari repository GitHub tersebut (hubungkan akun GitHub bila diminta).
3. Pengaturan yang dibutuhkan:
   - **Runtime**: Node.js 18 atau lebih baru
   - **Install**: `npm install` (biasanya otomatis)
   - **Start command / entry point**: `npm start` (atau `node server.js`)
   - **Port**: jangan diubah di kode. Server memakai `process.env.PORT` dari Suga (lokal: 3000).
   - **Health check** (jika ada kolomnya): path `/health`
4. Setelah deploy, salin **URL publik** (harus `https://`). Uji di browser:
   - `https://URL-KAMU/health` → JSON `ok: true`
   - `https://URL-KAMU/api/rooms` → `{"rooms":[],...}`
5. **Pastikan WebSocket didukung Suga.** Signaling PeerJS memakai WebSocket (`wss://URL-KAMU/peerjs`). Jika Suga tidak mendukung WebSocket, ONLINE tidak akan bisa tersambung. Solusinya: jalankan signaling PeerJS di layanan lain dan isi `PEERJS_HOST`/`PEERJS_PATH` ke sana (registry `/api` tetap di Suga).
6. Hosting gratis sering “tidur” saat sepi: request pertama bisa lambat; game akan menampilkan OFFLINE/timeout sampai server bangun — tekan REFRESH.

**Variabel lingkungan (opsional, tidak berisi rahasia wajib):**

| Variabel | Fungsi |
|---|---|
| `PORT` | Diberikan Suga. Default 3000. |
| `ALLOWED_ORIGINS` | Daftar origin yang boleh memanggil API, pisah koma. Default `*`. Setelah tahu origin itch.io kamu, boleh dibatasi. |
| `ROOM_TTL_MS` | Batas waktu room tanpa heartbeat (default 20000). |
| `ROOM_DEAD_GRACE_MS` | Masa tenggang sebelum room yang peer host-nya putus dari signaling dihapus permanen (default 8000). Selama itu room sudah disembunyikan dari daftar. |

UDP/broadcast LAN **tidak** dipakai di cloud (tidak didukung hosting umum). Semua koneksi ke backend memakai HTTP(S) dan WebSocket.

---

## 4. Mengisi `config.js`

Buka `config.js` dan ganti setiap `"link kamu"`. Jangan menaruh password/secret di file ini — file ini publik.

| Kunci | Isi | Contoh bentuk |
|---|---|---|
| `SERVER_URL` | URL publik backend (Suga), `https://`, tanpa `/` di akhir. Dipakai untuk `/health` (ONLINE/OFFLINE + ping). | `https://nama-app.contoh.app` |
| `API_BASE_URL` | URL dasar API daftar server. Biasanya `SERVER_URL` + `/api`. Boleh `""` agar otomatis. | `https://nama-app.contoh.app/api` |
| `PEERJS_HOST` | Hostname signaling saja (tanpa `https://`, tanpa path). Dengan `server.js` bawaan = hostname yang sama dengan Suga. | `nama-app.contoh.app` |
| `PEERJS_PORT` | Port signaling. Untuk HTTPS biasanya `443`. | `443` |
| `PEERJS_SECURE` | `true` untuk `wss://`. | `true` |
| `PEERJS_PATH` | Path signaling. `server.js` memakai `/peerjs`. | `"/peerjs"` |
| `ICE_SERVERS` | Opsional: server TURN (lihat bagian 6). | `[]` |

Ketiga URL **tidak dianggap otomatis sama**: kamu bisa memisahkan API dan signaling ke host berbeda. Jika `config.js` masih berisi `"link kamu"`/kosong, layar ONLINE menampilkan **KONFIGURASI BELUM LENGKAP** beserta kunci yang harus diisi, dan tidak mencoba terhubung diam-diam. Tidak ada fallback ke `localhost`.

---

## 5. Publikasi frontend di itch.io

1. Isi `config.js` dengan URL Suga kamu.
2. Buat ZIP berisi **`index.html` dan `config.js` di akar ZIP** (bukan di dalam subfolder). Hanya dua file itu yang dibutuhkan frontend.
3. itch.io → *Create new project* → *Kind of project*: **HTML** → unggah ZIP → centang **This file will be played in the browser** → atur ukuran viewport (mis. 960×540 atau “Fullscreen button”) → Save → buka halaman untuk menguji.
4. Game memuat Three.js dan PeerJS dari CDN (cdnjs/unpkg/jsdelivr); pemain butuh internet.
5. Semua alamat backend wajib **HTTPS/WSS** (halaman itch.io berjalan di HTTPS; HTTP akan diblokir sebagai *mixed content*).
6. Jika API menolak karena CORS, set `ALLOWED_ORIGINS` di Suga ke origin yang muncul di pesan error console browser (atau biarkan `*`).
7. Game berjalan di iframe: tombol layar penuh game tetap tersedia; WebRTC umumnya berjalan di iframe itch.io, tetapi hasilnya tetap bergantung pada jaringan pemain.

---

## 6. Batasan yang perlu kamu ketahui

- **WebRTC tidak selalu tembus.** Dengan hanya STUN, sebagian jaringan (NAT ketat, data seluler, Wi-Fi kampus/kantor) gagal tersambung langsung. Perbaikannya server **TURN**; isi `ICE_SERVERS` di `config.js`. Kredensial TURN akan terlihat publik, jadi pakai kredensial terbatas/sementara. Backend ini **tidak** menyediakan TURN.
- **ONLINE: tidak ada pergantian host.** Jika host putus, sesi berakhir untuk semua guest dan ronde hilang (disengaja). Waktu terburuk sampai guest sadar jika host crash tanpa `bye` ≈ 8 dtk + 10 dtk. **LAN: ada host migration** (bagian 2e).
- **Tidak bisa bergabung saat game sudah berjalan** (status BERMAIN). Pemain baru hanya masuk di lobi, jadi tidak ada snapshot tengah-game.
- Daftar room disimpan di **memori** server: restart/redeploy mengosongkan daftar (host otomatis mendaftar ulang saat heartbeat berikutnya jika masih hidup).
- Ping yang ditampilkan adalah ping **ke server backend**, bukan ke host room (koneksi ke host adalah P2P dan baru terbentuk saat bergabung).
- Maksimal 4 pemain per room. Satu alamat IP dibatasi 5 room aktif.
- Mengikuti sifat WebRTC, alamat IP pemain dapat terlihat oleh pemain lain di room yang sama.

---

## 7. Yang berubah dari BUS_14_v3.html

- `index.html`: menu → **MULTIPLAYER LAN** + **MULTIPLAYER ONLINE**; layar daftar server (cari, refresh, buat server, gabung via daftar atau ID, status ONLINE/OFFLINE + ping, penuh/bermain); lobi menampilkan nama server; penanganan error/loading yang jelas.
- Mesin room (`mkRoom`): prefix ID terpisah (`b14l-` LAN, `b14o-` ONLINE), opsi signaling dari `config.js`, TURN opsional, reconnect signaling, validasi/penjepitan data pemain, daftar putih jenis pesan dari klien, batas ukuran & laju pesan.
- Versi ini: host/guest — `bye`, heartbeat + masa tenggang, sambung ulang bertoken, kunci keluar guest, layar HOST TERPUTUS, validasi room mati di `server.js`/`server/rooms.js`.
- **Host migration LAN** (2e): hanya `index.html` (mesin `mkRoom`, `mpJoin`, blok HOSTGUARD) + tes baru `test/migration.test.js`, `test/migui.test.js`. Backend tidak berubah.
- Baru: `config.js`, `server.js`, `server/rooms.js`, `server/http.js`, `package.json`, `test/`, `.gitignore`, README ini.
- **Nama custom pemain** (2g): `index.html` (pembersih `cleanName`, input nama di layar LAN/ONLINE/Pengaturan, penegakan di host `cl()`/`np()`, tampilan `nm()`/`recName()`, `mpJoin`, registry `hostName`), `server/rooms.js` (`cleanName` untuk `hostName`), `test/playername.test.js`, `tools/e2e-lokal/`.
- Tidak diubah: gameplay, anomali, suara, kontrol, kustomisasi karakter (topi/baju/celana), chat, singleplayer.

Struktur:

```
BUS14-ONLINE/
  index.html        game (frontend)
  config.js         alamat backend (edit ini)
  server.js         entry point Node.js (Express + signaling PeerJS)
  server/rooms.js   registry daftar room
  server/http.js    /health dan /api/rooms
  test/             tes otomatis (npm test)
  tools/e2e-lokal/  uji E2E opsional di browser (Playwright; bukan bagian npm test)
  package.json  .gitignore  README.md
```
`package-lock.json` tidak disertakan (dibuat otomatis saat kamu menjalankan `npm install` pertama kali; commit file itu).

---

## 8. Pengujian

`npm test` menjalankan:
- `test/rooms.test.js` – logika registry (validasi, TTL, token, batas).
- `test/http.test.js` – server HTTP sungguhan: health, buat room → muncul di daftar → heartbeat → penuh → BERMAIN → host keluar, LAN/ONLINE terpisah, CORS, input rusak.
- `test/p2p.test.js` – protokol room dari `index.html` memakai **Peer tiruan di memori** (bukan WebRTC sungguhan): bergabung, room penuh, started, relay & penolakan pesan palsu, sanitasi, rate limit; **host keluar normal (3 guest), tab ditutup, internet host putus (timeout), host kembali dalam masa tenggang, guest putus sebentar/terlalu lama, penyusup stale, host palsu**.
- `test/hidden.test.js` – fitur sembunyikan room: registry, HTTP sungguhan (tidak bocor di daftar & /health, toggle saat berjalan, token), dan kode klien dari `index.html` dijalankan terhadap server HTTP nyata (toggle, daftar ulang, server mati).
- `test/kickui.test.js` + bagian kick di `test/p2p.test.js` – fitur Kick (UI host/guest, dialog konfirmasi, validasi host, pemain putus, anti-masuk-lagi).
- `test/migration.test.js` – **host migration LAN** dengan Peer tiruan: host keluar di lobi (3 guest), host putus mendadak saat gameplay (posisi dipertahankan), Room ID direbut kembali, relay/presence lewat host baru, calon host mati saat migrasi, koordinator ikut mati, satu guest tersisa, host baru keluar lagi (berantai), guest keluar biasa tidak memicu migrasi, pemenang acak bervariasi, guest terisolasi tidak merebut host, dan **ONLINE tetap berakhir seperti semula**.
- `test/migui.test.js` – sisi UI/game migrasi dengan DOM tiruan: label keluar host LAN, notifikasi, S.host, sync voting/board, pendaftaran ulang registry.
- `test/hostguard.test.js` – logika UI dengan DOM tiruan: kunci keluar guest, konfirmasi host, layar HOST TERPUTUS + hitung mundur, banner sambung-ulang.

- `test/playername.test.js` – **nama custom pemain**: pembersih nama (klien == server), input & penyimpanan dengan DOM tiruan (kosong/panjang/karakter aneh, nama server bawaan vs kustom), tampilan per-pemain (nama kembar), protokol room dengan Peer tiruan (host + 3 guest, nama tidak valid dibersihkan host, pemain baru, reconnect, guest keluar, kick, LAN host migration), registry/HTTP (`hostName`), dan pemeriksaan sintaks semua `<script>` inline.
- `tools/e2e-lokal/e2e.js` (**opsional**, butuh Playwright + Chromium; tidak ikut `npm test`) – memuat `index.html` di Chromium dan menjalankan skenario host+guest ONLINE & LAN lewat UI sungguhan. **PeerJS dan Three.js diganti stub** (tab saling terhubung lewat BroadcastChannel), jadi ini bukan uji WebRTC/Suga asli.

**Belum diuji** (butuh internet/perangkat nyata; berlaku juga untuk host migration — tesnya memakai Peer tiruan, bukan WebRTC asli): perilaku asli WebRTC saat tab host ditutup/internet putus (timing event `close` berbeda antar browser), event `connection`/`disconnect` PeerServer asli yang dipakai validasi room mati, `npm install`+`npm start` dengan Express/peer asli, koneksi WebRTC antar dua perangkat/jaringan, deployment Suga, upload itch.io, serta gameplay di browser. Lakukan uji manual dengan 2 perangkat (satu Wi-Fi, lalu data seluler) sebelum merilis.
