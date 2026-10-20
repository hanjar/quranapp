# PRD — Quran Web App

Versi: 1.0 · Tanggal: 20 Oktober 2026  
Status: Siap untuk desain dan perencanaan implementasi; keputusan terbuka tercantum di bagian 18.  
Gaya produk: modern, elegan, tenang, berpusat pada mushaf.

## 1. Ringkasan dan dasar kebutuhan

Quran Web App adalah aplikasi membaca Al-Qur’an berbasis Angular PWA dengan tampilan SVG Mushaf Madinah, riwayat Hafs, 604 halaman. Pengguna langsung melanjutkan halaman terakhir, membaca dengan gangguan visual minimal, menyimpan bookmark halaman atau ayat, dan menggunakan halaman yang sudah diunduh tanpa internet. Akun bersifat opsional dan hanya diperlukan untuk sinkronisasi antarperangkat.

Dokumen ini menggabungkan permintaan terbaru dengan percakapan “Saran Quran Web App”. Pesan pengguna yang terbaca menegaskan tiga tema, hosting Cloudflare, bookmark ayat/halaman, posisi terakhir, navigasi melalui gesture, serta handoff desain dari awal dengan navigasi lengkap. Sebagian jawaban asisten lama hanya tersedia sebagai referensi konten yang tidak terbuka; dokumen ini tidak menganggap detail yang tidak terbaca sebagai keputusan final.

**Kebutuhan terkonfirmasi:** SVG Mushaf Madinah Hafs 604 halaman; responsif HP/tablet dengan dukungan dua halaman; tap/double tap/long press; navigasi tersembunyi; bookmark ayat/halaman; otomatis melanjutkan; tema #EEEDEB, #F5F1E8, #F2EBDD; Angular PWA di Cloudflare Pages; Workers dan D1 untuk cloud sync opsional; offline-first; audio dan terjemahan P1; multi-riwayat dan tajwid P2.

**Usulan produk dalam PRD:** pemetaan gesture, breakpoint, pasangan halaman, aturan konflik sync, metode autentikasi, dan target performa. Semua merupakan baseline desain/engineering, bukan kutipan keputusan lama.

## 2. Masalah, tujuan, dan ukuran keberhasilan

### Masalah
- Pembaca ingin nuansa mushaf yang konsisten tanpa toolbar memenuhi layar.
- Kehilangan posisi terakhir dan bookmark mengganggu kelanjutan membaca.
- Internet tidak selalu tersedia, terutama saat bepergian.
- Tampilan dua halaman harus tetap terbaca di tablet tanpa memaksakannya di HP.

### Tujuan
1. Pengguna masuk langsung ke bacaan terakhir tanpa login wajib.
2. Tata letak mushaf dan ketepatan teks menjadi prioritas tertinggi.
3. Navigasi, bookmark, dan pengaturan mudah ditemukan meskipun antarmuka awal minimal.
4. Aktivitas membaca dan penyimpanan lokal tetap berfungsi saat offline.
5. Cloud sync menambah kenyamanan tanpa menjadi dependensi membaca.

### Target keberhasilan awal
| Indikator | Target penerimaan |
|---|---|
| Akurasi konten | Seluruh 604 aset lolos pemeriksaan kelengkapan; tidak ada perubahan teks yang tidak disetujui |
| Melanjutkan bacaan | Semua skenario uji normal membuka halaman tersimpan yang tepat |
| Usability | Minimal 4 dari 5 peserta uji dapat membuka navigasi dan membuat bookmark tanpa bantuan setelah petunjuk awal |
| Offline | Semua halaman yang ditandai siap offline terbuka dalam mode pesawat |
| Respons gesture | Umpan balik visual ≤100 ms, kecuali menunggu pembedaan single/double tap |
| Pergantian halaman cache | Target p95 ≤300 ms pada perangkat Android kelas menengah yang ditetapkan saat QA |
| Tampilan awal | Target LCP ≤2,5 detik pada profil jaringan/perangkat uji yang didokumentasikan |

Metrik performa adalah target proyek, bukan hasil pengukuran saat ini. Pengukuran penggunaan tidak boleh mengirim riwayat ayat/halaman pribadi tanpa persetujuan; QA lokal cukup untuk peluncuran awal.

## 3. Pengguna dan prinsip pengalaman

**Pembaca harian:** ingin segera melanjutkan, menandai bacaan, dan tidak terganggu fitur tambahan.

**Pembaca tablet:** menginginkan spread dua halaman yang menyerupai mushaf cetak, termasuk saat rotasi perangkat.

**Pembaca lintas perangkat:** ingin bookmark tersedia di HP dan tablet melalui sync opsional.

**Pembaca dengan koneksi terbatas:** ingin mengetahui halaman mana yang benar-benar tersedia offline.

Prinsip: mushaf menjadi pusat layar; setiap gesture memiliki alternatif tombol; tidak ada login wall; status penyimpanan jujur; dekorasi tidak mengubah teks; fitur lanjutan muncul sesuai konteks.

## 4. Scope dan prioritas

| Area | P0 — rilis inti | P1 | P2 |
|---|---|---|---|
| Konten | Hafs, Mushaf Madinah 604 halaman SVG dan metadata tervalidasi | — | Riwayat/edisi tambahan |
| Reader | Satu halaman HP, dua halaman tablet jika cukup lebar, zoom | Penyempurnaan preferensi | — |
| Navigasi | Halaman, surah, juz, berikut/sebelum, deep link | Pencarian teks bila dataset siap | — |
| Interaksi | Tap, double tap, long press dan alternatif tombol | — | — |
| Penyimpanan | Bookmark halaman/ayat, posisi terakhir, ekspor/impor | — | — |
| Offline | Cache halaman terbaca, unduh seluruh mushaf, kelola unduhan | Paket audio/terjemahan | — |
| Cloud | Workers+D1, login opsional, sync bookmark/posisi/preferensi | Penyempurnaan pemulihan | — |
| Tema | Tiga warna latar yang ditentukan | — | Tema tambahan hanya jika diminta |
| Bacaan pendamping | — | Audio dan terjemahan Indonesia | Tajwid tervalidasi |

Cloud sync termasuk P0 dengan jalur rilis terpisah: reader lokal dapat diluncurkan dahulu jika sync belum siap, dengan fitur cloud disembunyikan dan status rilis dicatat jelas.

**Di luar scope:** jejaring sosial, komentar publik, gamifikasi, iklan, editor teks Quran, tafsir lengkap, aplikasi native terpisah, AI penafsir, serta jaminan biaya hosting selalu nol. Riwayat selain Hafs dan tajwid tidak masuk rilis inti.

## 5. Arsitektur informasi dan layar

1. **Reader:** SVG mushaf, indikator seleksi, status muat/gagal, kontrol tersembunyi.
2. **Navigasi:** tab Surah, Juz, Halaman; input nomor halaman; daftar dan posisi aktif.
3. **Bookmark:** tab Ayat/Halaman, daftar, buka, hapus, keadaan kosong.
4. **Menu ayat:** identitas surah:ayat, simpan/hapus bookmark; slot audio/terjemahan hanya saat P1 tersedia.
5. **Pengaturan:** tema, tampilan otomatis/satu/dua halaman, bantuan gesture, unduhan, ekspor/impor, cloud sync.
6. **Unduhan:** ukuran estimasi, progres, jeda/lanjut, retry, hapus cache mushaf.
7. **Cloud:** login, logout, persetujuan sync, status, konflik posisi, hapus data cloud.
8. **Bantuan awal:** petunjuk singkat sekali tampil; dapat dibuka lagi.

Bahasa antarmuka awal Indonesia. Teks mushaf tetap Arab RTL; panel dan label Indonesia memakai arah LTR yang tepat.

## 6. Tampilan responsif dan tema

### Tata letak
- HP portrait: satu halaman, fit-width, tidak memotong teks atau bingkai.
- Tablet/desktop: mode otomatis dua halaman jika lebar konten efektif minimal 900 CSS px dan masing-masing halaman masih terbaca; angka ini usulan awal yang harus diuji pada aset nyata.
- Bila ruang sempit, otomatis kembali satu halaman. Preferensi dua halaman tidak boleh menghasilkan teks terlalu kecil tanpa opsi zoom/satu halaman.
- Pertahankan rasio aspek SVG; gunakan viewBox asli. Jangan mereflow ayat atau mengubah urutan baris.
- Arah baca spread RTL: halaman bernomor ganjil berada di kanan, genap berikutnya di kiri, mengikuti pemetaan edisi yang diverifikasi. Pembuka 1–2 dan batas akhir 603–604 wajib dibandingkan dengan sumber mushaf sebelum dikunci.
- Page spread maju ke pasangan berikutnya; halaman aktif tetap eksplisit. Deep link ke halaman genap tetap mengaktifkan halaman tersebut, meski spread menampilkan pasangannya.
- Rotasi dan pergantian mode mempertahankan halaman aktif dan bookmark; zoom boleh direset ke fit dengan pemberitahuan visual ringan.

### Tema
| Nama usulan | Warna permukaan mushaf |
|---|---|
| Abu Hangat | #EEEDEB |
| Ivory | #F5F1E8 |
| Sand | #F2EBDD |

Default usulan: #EEEDEB. Tema mengubah permukaan reader dan panel yang selaras, menjaga tinta Quran tetap jelas. Aset harus transparan atau disiapkan dengan metode yang tidak menghapus tanda baca; hindari filter warna global yang merusak harakat atau tajwid. Seluruh komponen interaktif harus memenuhi kontras WCAG AA. Jangan mengklaim kontras lolos sebelum diuji.

Gaya: whitespace lapang, garis tipis, ikon konsisten, bayangan halus, sudut panel lembut, animasi singkat tanpa efek membalik buku yang mengganggu. Hormati reduced motion dan safe area perangkat.

## 7. Gesture dan aturan interaksi

Pemetaan berikut adalah usulan konsisten untuk prototipe:

| Input | Perilaku |
|---|---|
| Single tap area mushaf | Tampilkan/sembunyikan toolbar atas dan bawah |
| Double tap ayat | Pilih ayat dan buka tindakan bookmark melalui panel ringkas |
| Long press ayat ≥500 ms | Pilih ayat dan buka menu konteks |
| Double tap area kosong | Tidak memicu navigasi atau bookmark |
| Swipe horizontal | Berpindah halaman sesuai arah RTL yang diuji; alternatif tombol selalu tersedia |
| Pinch | Zoom, tanpa memicu swipe halaman saat diperbesar |
| Escape/tap backdrop | Tutup panel; kembalikan fokus ke pemicu |

Single tap menunggu jendela double tap usulan 280 ms agar tidak menampilkan toolbar sebelum double tap. Nilai timing harus diuji lintas perangkat. Long press dibatalkan saat gerakan melebihi toleransi usulan 10 CSS px; jangan mematikan interaksi browser secara global.

Toolbar berisi navigasi, nomor halaman, bookmark halaman aktif, dan pengaturan. Auto-hide usulan setelah 4 detik tanpa interaksi, tetapi tidak saat fokus keyboard berada di kontrol, panel terbuka, pembaca layar aktif berinteraksi, atau audio dikontrol. Ada pilihan “Selalu tampilkan kontrol”. Petunjuk “Ketuk halaman untuk navigasi” muncul pada penggunaan pertama.

Hit area ayat harus mencakup setiap fragmen ayat yang melintasi beberapa baris dan menunjuk ke identitas ayat yang sama. Jika koordinat belum valid, jangan mengaktifkan seleksi ayat yang dapat salah menandai; ini blocker untuk bookmark ayat P0.

## 8. User stories dan acceptance criteria

| ID | User story | Acceptance criteria |
|---|---|---|
| US-01 | Sebagai pembaca, saya ingin langsung membaca tanpa akun | Given instalasi baru, when membuka app, then halaman 1 tampil dan login tidak menghalangi |
| US-02 | Saya ingin melanjutkan bacaan terakhir | Given halaman 120 selesai tampil dan tersimpan, when app ditutup lalu dibuka, then halaman 120 dipulihkan; direct link eksplisit mengungguli posisi terakhir |
| US-03 | Saya ingin navigasi tanpa mengganggu mushaf | Tap tunggal menampilkan kontrol; double tap tidak menjalankan aksi tap tunggal; semua fungsi tersedia melalui tombol |
| US-04 | Saya ingin lompat ke halaman/surah/juz | Input hanya menerima halaman 1–604; surah/juz menuju metadata awal yang benar; input invalid memberi pesan tanpa merusak posisi |
| US-05 | Saya ingin bookmark halaman | Aksi simpan memberi umpan balik, tetap ada setelah restart/offline, aksi berulang tidak menduplikasi bookmark |
| US-06 | Saya ingin bookmark ayat | Tap ganda/long press memilih ayat yang tepat, menampilkan surah:ayat, dan menyimpan ID ayat stabil; ayat lintas baris tetap satu bookmark |
| US-07 | Saya ingin membaca dua halaman di tablet | Spread RTL benar, tidak ada halaman hilang/duplikat pada seluruh transisi, rotasi mempertahankan halaman aktif |
| US-08 | Saya ingin memilih tema | Ketiga warna tersedia, pilihan segera diterapkan dan tersimpan setelah restart; harakat tetap jelas |
| US-09 | Saya ingin membaca offline | Setelah unduhan terverifikasi selesai, seluruh 604 halaman terbuka saat mode pesawat; halaman belum tersedia menampilkan aksi unduh saat online |
| US-10 | Saya ingin sync opsional | Pengguna lokal tetap dapat membaca; login menyatukan bookmark tanpa kehilangan data lokal; gangguan server tidak membatalkan penyimpanan lokal |
| US-11 | Saya ingin tahu status sync | UI membedakan lokal tersimpan, menunggu, tersinkron, dan gagal; retry tidak membuat duplikasi |
| US-12 | Saya ingin membawa data saya | Ekspor lokal menghasilkan JSON berversi; impor valid menambah/merge data; file salah ditolak dengan penjelasan |
| US-13 | Saya ingin mengelola ruang | Hapus cache mushaf tidak menghapus bookmark atau posisi; status ketersediaan offline diperbarui |
| US-14 | Saya ingin penggunaan yang aksesibel | Kontrol berlabel, fokus terlihat, panel dapat ditutup keyboard, target sentuh minimal 44×44 CSS px; tidak ada aksi wajib gesture |

P1 audio: pengguna dapat play/pause, pilih qari, memilih ayat, dan melihat error jaringan. Tidak ada autoplay setelah membuka app; perpindahan ayat mengikuti timing tervalidasi, bukan perkiraan. P1 terjemahan: teks Indonesia berlisensi ditautkan dengan ID ayat, dapat dibuka/tutup tanpa mengganti layout mushaf, dan sumber ditampilkan.

## 9. Flow utama

### A. Pertama kali
Buka URL → muat app shell dan metadata → tampilkan halaman 1 → petunjuk gesture ringkas → baca. Tawaran instalasi, unduh offline, dan sync tidak memblokir reader.

### B. Kembali membaca
Buka app → baca posisi lokal → validasi rentang/edisi → tampilkan halaman → simpan setelah render berhasil → sync di latar jika diaktifkan. Jika remote memiliki posisi berbeda, tampilkan pilihan melanjutkan posisi perangkat lain; jangan memindahkan halaman pengguna yang sedang membaca secara mendadak.

### C. Navigasi
Tap → toolbar → navigasi → pilih surah/juz/nomor → muat target → tandai halaman aktif → simpan posisi. Tombol Back mengembalikan konteks sesuai histori navigasi yang dirancang; panel ditutup lebih dahulu jika terbuka.

### D. Bookmark
Pilih ayat atau tekan bookmark halaman → simpan lokal atomik → tampilkan status tersimpan → antrekan sync bila aktif. Buka daftar → pilih item → arahkan ke halaman dan sorot ayat bila relevan. Hapus menyediakan Undo singkat dan tombstone untuk sync.

### E. Unduhan
Pengaturan → Unduh mushaf → tampilkan estimasi ukuran → pengguna mulai → unduh bertahap → validasi checksum → tandai lengkap. Putus koneksi/storage penuh → simpan progres → tampilkan retry/kelola ruang → lanjut hanya aset yang belum valid.

### F. Aktivasi cloud
Pilih sync → jelaskan data yang dikirim → login → merge bookmark lokal dan cloud → tentukan posisi terakhir jika konflik → push antrean → pull perubahan → status tersinkron. Logout menonaktifkan sync; jelaskan apakah salinan lokal dipertahankan dan sediakan pilihan hapus data perangkat.

## 10. Offline-first dan persistensi

- IndexedDB menyimpan bookmark, posisi, preferensi, manifest unduhan, dan antrean sync. Cache Storage menyimpan SVG serta app shell sesuai kebijakan cache.
- App shell dan metadata minimum diprecache. Halaman aktif disimpan saat dibaca; prefetch beberapa halaman tetangga secara terbatas sesuai koneksi dan ruang.
- Unduh 604 halaman merupakan aksi eksplisit, bukan download besar otomatis saat kunjungan pertama. Ukuran ditentukan dari manifest aset nyata, tidak dihardcode sebagai estimasi palsu.
- Status “Siap offline” hanya setelah seluruh aset paket lolos validasi. Kemajuan mencerminkan jumlah/byte terverifikasi.
- Cache browser dapat terhapus oleh sistem. Periksa ketersediaan aktual saat membuka app; storage persistence diminta jika didukung tanpa menjanjikan penyimpanan permanen.
- Halaman gagal dimuat tidak boleh menggantikan posisi terakhir yang valid.
- Pembaruan konten memakai contentVersion dan manifest checksum. Jangan mencampurkan SVG dengan koordinat dari versi berbeda.
- Update app tidak memaksa reload di tengah membaca. Sediakan pemberitahuan pembaruan dan migrasi database yang tidak menghapus data.
- Kunjungan pertama tanpa jaringan dan tanpa cache menampilkan penjelasan; offline-first tidak berarti konten tersedia sebelum pernah diunduh.
- Sinkronisasi dijalankan saat app aktif, login, perubahan data, reconnect, dan aksi manual. Jangan bergantung pada Background Sync yang belum tentu didukung perangkat.

## 11. Arsitektur teknis yang dituju

```text
Angular PWA di Cloudflare Pages
  ├─ SVG + metadata + manifest konten statis/CDN
  ├─ IndexedDB: data pembaca + outbox
  ├─ Cache Storage / service worker: app shell + konten
  └─ HTTPS API → Cloudflare Workers → D1
                    └─ Penyedia identitas untuk login opsional
```

Gunakan Angular versi stabil yang disepakati saat implementasi; kunci versi dependensi. Rendering reader dilakukan di klien; SSR bukan kebutuhan P0. Pages menyajikan build statis beserta fallback rute SPA yang diverifikasi untuk deep link. Workers menangani autentikasi, validasi, otorisasi, sync, dan penghapusan cloud. D1 menyimpan data pengguna, bukan blob 604 SVG.

Angular service worker mendukung app offline dan cache berbasis konfigurasi. Pengelolaan paket unduhan besar, progres, validasi, serta penghapusan parsial perlu lapisan khusus yang dirancang agar tidak berebut cache dengan service worker bawaan. Tetapkan satu pemilik untuk tiap cache dan uji update versi.

Cloudflare free tier menjadi target biaya awal. Kuota request, CPU, storage, operasi D1, build dan ukuran aset harus diperiksa kembali menjelang deploy. Saat kuota habis, sync boleh tertunda dengan retry; reader lokal tetap berfungsi. Hindari polling agresif serta write posisi pada setiap frame/gesture. Aset SVG dilayani langsung dari CDN.

## 12. Model data

### Metadata konten, read-only
| Entitas | Field inti |
|---|---|
| Edition | editionId, riwayah=hafs, pageCount=604, contentVersion, source, license, checksumManifest |
| Page | editionId, pageNumber, svgUrl, checksum, byteSize, viewBox, firstAyahId, lastAyahId |
| Surah | surahId, nameArabic, nameLatin, ayahCount, startPage |
| Ayah | ayahId, surahId, ayahNumber |
| AyahPageRegion | editionId, contentVersion, ayahId, pageNumber, fragments[] berisi polygon/path/rect dalam koordinat SVG |
| JuzBoundary | juzNumber, ayahId, pageNumber, region opsional |

AyahId kanonik berbentuk surah:ayat; keterkaitan halaman bersifat spesifik edisi. Satu ayat dapat memiliki beberapa region dan, jika dataset menuntutnya, beberapa halaman. Metadata P2 tidak boleh mengasumsikan nomor ayat/halaman identik antarriwayat.

### Data pembaca dan sync
| Entitas | Field inti |
|---|---|
| Bookmark | id UUID, userId nullable lokal, type=ayah/page, editionId, ayahId nullable, pageNumber nullable, createdAt, updatedAt, deletedAt nullable, serverRevision |
| ReadingPosition | editionId, pageNumber, ayahId nullable, activePage, updatedAt, deviceId, serverRevision |
| Preferences | themeId, layoutMode, controlsAlwaysVisible, schemaVersion, updatedAt |
| DownloadEntry | editionId, contentVersion, pageNumber, checksum, state, downloadedBytes, verifiedAt |
| OutboxOperation | operationId UUID, entityType, entityId, action, payload, baseRevision, retryCount, nextAttemptAt |
| SyncState | accountId, cursor, lastSuccessAt, status, lastErrorCode |
| User (cloud) | id, identitySubject, createdAt, deletedAt nullable |
| Device (cloud) | id, userId, displayName opsional, lastSeenAt |

Constraint: halaman 1–604 untuk edisi ini; ayat harus ada di metadata; bookmark type ayah mewajibkan ayahId; type page mewajibkan pageNumber. Deduplikasi bookmark aktif memakai semantic key pengguna+edisi+jenis+target. Catatan bebas dan label kustom bukan kebutuhan P0.

## 13. Kontrak sync dan konflik

Usulan endpoint: GET /v1/sync?cursor=…, POST /v1/sync/batch, GET /v1/me, DELETE /v1/me/data. Autentikasi mengikuti penyedia identitas yang dipilih; jangan membuat protokol password sendiri.

Respons konsisten: success, data, error {code,message}, meta {cursor,hasMore}. Request batch memiliki batas ukuran/jumlah operasi dan operationId untuk idempotensi. Pagination wajib untuk perubahan besar. SQL menggunakan parameter binding; seluruh query dibatasi pemilik akun dari sesi server, bukan userId kiriman klien.

Aturan:
1. Commit lokal lebih dahulu, lalu outbox dalam transaksi yang sama.
2. Server memberikan revision monoton dan cursor; timestamp klien hanya informasi, bukan satu-satunya dasar urutan.
3. Retry operationId yang sama mengembalikan hasil sama tanpa menggandakan entitas.
4. Bookmark berbeda digabung; bookmark target sama dideduplikasi. Penghapusan memakai tombstone.
5. Perubahan dengan baseRevision usang dikembalikan sebagai konflik. Hapus menang terhadap edit stale; tambah kembali setelah hapus harus merupakan aksi baru eksplisit terhadap revision terkini.
6. Posisi baca berbeda antarperangkat tidak otomatis mengambil nomor halaman terbesar. Saat cold start tawarkan remote yang lebih baru; saat sesi aktif jangan pindahkan bacaan.
7. Preferensi memakai revision server; perubahan stale harus pull/rekonsiliasi sebelum retry.
8. Tombstone dan riwayat perubahan memiliki kebijakan retensi terdokumentasi. Klien dengan cursor kedaluwarsa melakukan full reconciliation agar bookmark terhapus tidak hidup kembali.
9. Backoff eksponensial dengan jitter; 401 meminta login ulang, 429 menghormati retry, error jaringan tetap menyimpan outbox.
10. Pergantian akun mengisolasi cache data privat dan outbox per akun; operasi akun A tidak boleh dikirim ke B. Data anonim hanya digabung setelah persetujuan yang jelas.

## 14. Keamanan, privasi, dan integritas Quran

- Wajib validasi sumber, lisensi redistribusi, edisi, kelengkapan 604 halaman, penomoran, dan koordinat ayat sebelum rilis. Tidak ada sumber aset yang diasumsikan sudah disetujui.
- Dua tahap pemeriksaan: otomatis untuk manifest/metadata dan pemeriksaan visual oleh reviewer yang kompeten untuk mushaf serta pemetaan ayat. Semua koreksi konten memiliki provenance dan persetujuan.
- Jangan membangkitkan atau menulis ulang teks Quran menggunakan AI. SVG tidak boleh memuat script, handler aktif, foreignObject atau referensi eksternal yang tidak disetujui. Sanitasi dilakukan saat pipeline aset; penerapan CSP dan allowlist sumber wajib.
- HTTPS; secret hanya pada lingkungan server. Sesi memakai mekanisme aman, token tidak diletakkan di URL. Jika memakai cookie, gunakan HttpOnly/Secure/SameSite dan perlindungan CSRF sesuai arsitektur origin.
- Batasi origin API, verifikasi identitas, rate limit, batasi batch dan validasi semua identifier. Error publik tidak mengungkap SQL, token, atau detail internal.
- Simpan hanya data akun minimum dan data baca yang disetujui. Jangan log token atau bookmark/riwayat terperinci. Sync dinonaktifkan sebelum login/persetujuan.
- Sediakan ekspor, hapus data cloud, serta penjelasan logout dan data lokal. Penghapusan cloud harus mencegah outbox lama mengunggah ulang data yang baru dihapus.
- Klaim end-to-end encryption tidak boleh dibuat tanpa implementasi dan kajian khusus; bukan scope P0.

## 15. Aksesibilitas dan pengujian

SVG visual saja tidak cukup untuk akses pembaca layar. Sediakan nama halaman, identitas surah/ayat pada kontrol dan alternatif daftar ayat semantik dari dataset terverifikasi yang dipetakan ke mushaf; jangan membuat ratusan fragmen path menjadi tab stop. Jika alternatif teks ayat belum tersedia, catat keterbatasan aksesibilitas secara eksplisit dan jangan mengklaim kepatuhan penuh.

Matriks QA mencakup Android Chrome, iPhone/iPad Safari, browser desktop utama, mode standalone PWA jika didukung, portrait/landscape, keyboard, pembaca layar, jaringan lambat/offline, storage penuh, serta storage yang terhapus. Perangkat/versi minimum ditetapkan sebelum implementasi.

- Unit: pemetaan spread, validasi target, gesture arbitration, deduplikasi, konflik, migrasi, cursor, antrean retry.
- Integrasi: IndexedDB, transaksi outbox, cache manifest, Worker auth/otorisasi, D1 idempotensi dan pagination.
- E2E: buka pertama, resume, deep link, navigasi 1/604, bookmark ayat/halaman, tema, rotasi, paket offline terputus/lanjut, login/logout, dua perangkat konflik, isolasi akun, update versi.
- Konten: keberadaan/checksum seluruh halaman, cakupan koordinat, surah/juz boundaries, sampling visual seluruh halaman dan verifikasi khusus batas.
- Security: akses silang akun ditolak, payload invalid ditolak, SVG aktif ditolak, ekspor/impor dibatasi ukuran dan schema.
- Target coverage kode minimum 80%; TDD untuk logika inti. Coverage tidak menggantikan verifikasi konten dan pengujian perangkat nyata.

## 16. Roadmap dan gerbang rilis

| Tahap | Hasil | Gerbang keluar |
|---|---|---|
| 0 — Validasi sumber | Aset berlisensi, manifest, koordinat ayat, benchmark ukuran | Reviewer konten menyetujui dataset dan model spread |
| 1 — Claude Design | Design system dan prototipe alur lengkap | Uji 5 pengguna; gesture dan navigasi dipahami |
| 2 — Reader lokal P0 | Angular reader, tema, navigasi, bookmark, resume | Acceptance criteria lokal dan aksesibilitas dasar lulus |
| 3 — Offline/PWA | Instalasi, cache, unduh, update aman, ekspor/impor | Uji offline 604 halaman serta pemulihan unduhan lulus |
| 4 — Sync opsional P0 | Auth, Workers, D1, konflik, penghapusan data | Uji dua akun/dua perangkat dan review keamanan lulus |
| 5 — Pilot dan rilis | Uji perangkat nyata, perbaikan, panduan operasional | Tidak ada bug kritis/tinggi terbuka; konten disetujui |
| 6 — P1 | Audio dan terjemahan | Lisensi, mapping, kontrol offline dan QA audio selesai |
| 7 — P2 | Multi-riwayat dan tajwid | Model edisi/versifikasi dan pemeriksaan ahli disetujui |

Urutan ini menunjukkan dependensi, bukan janji tanggal. Estimasi dibuat setelah audit dataset dan prototipe teknis koordinat/cache.

## 17. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi / gerbang |
|---|---|---|
| Lisensi atau sumber mushaf tidak jelas | Tidak boleh rilis | Verifikasi tertulis sebelum distribusi |
| Koordinat ayat salah | Bookmark menunjuk ayat keliru | Dataset region berversi, overlay QA, pemeriksaan ahli |
| SVG besar/rumit | Lambat dan boros memori | Benchmark aset nyata, optimasi tanpa mengubah glyph, render hanya spread aktif |
| Background SVG tidak transparan | Tema tidak tampak | Audit aset sebelum desain tema dikunci |
| Gesture bertabrakan | Aksi salah/tidak ditemukan | Arbitration tunggal, petunjuk, tombol alternatif, uji pengguna |
| Storage browser dieviction | Konten/data lokal hilang | Periksa cache, ekspor, cloud opsional, penjelasan keterbatasan |
| Konflik sync | Data hilang/terhapus muncul lagi | Revision, tombstone, idempotensi, full reconciliation |
| Kuota layanan gratis habis | Sync gagal | Batch, backoff, observabilitas kuota; reader lokal tetap jalan |
| Pembaruan versi parsial | SVG dan region berbeda | Manifest atomik per versi, checksum, rollback |
| Dua halaman terlalu kecil | Sulit membaca | Minimum ukuran, fallback satu halaman, zoom |
| SVG tidak aksesibel | Pengguna pembaca layar terhambat | Alternatif semantik dari sumber terverifikasi |
| P2 dianggap sekadar ganti aset | Kesalahan riwayat/tajwid | Kajian tersendiri atas versifikasi dan representasi konten |

## 18. Keputusan terbuka dan asumsi

Sebelum engineering dimulai, tetapkan: sumber dan lisensi SVG; metadata region ayat dan teks aksesibel; aturan spread sesuai edisi; ukuran paket aktual; perangkat minimum; penyedia login dan origin API; kebijakan retensi/tombstone; penanggung jawab review Quran; serta sumber qari dan terjemahan untuk P1.

Desain dapat dimulai menggunakan placeholder yang jelas. Placeholder tidak boleh dianggap sebagai teks mushaf yang layak dipublikasikan. Tidak diperlukan keputusan P1/P2 untuk menyelesaikan reader lokal P0, tetapi struktur editionId/contentVersion harus tersedia sejak awal.

## 19. Handoff siap pakai — Claude Design

### Brief
Rancang Quran Web App dari awal dengan gaya modern elegan, tenang, dan berpusat pada Mushaf Madinah Hafs 604 halaman berbentuk SVG. Antarmuka awal menampilkan mushaf dengan kontrol tersembunyi. HP memakai satu halaman; tablet mendukung dua halaman RTL jika cukup ruang. Jangan mereflow atau menggambar ulang teks Quran.

Gunakan tiga tema permukaan: #EEEDEB, #F5F1E8, #F2EBDD. Pertahankan keterbacaan tinta dan tanda baca. Buat hierarki tipografi panel Indonesia yang bersih, ikon konsisten, ruang lapang, dan animasi ringan.

### Layar yang wajib didesain
- Reader HP dengan kontrol tersembunyi dan terlihat, tablet dua halaman, landscape, zoom.
- Navigasi lengkap: daftar surah, juz, input halaman, posisi aktif dan input invalid.
- Pemilihan ayat, highlight multi-baris, menu ayat dan bookmark halaman.
- Daftar bookmark ayat/halaman: terisi, kosong, hapus dan Undo.
- Pengaturan tema, layout otomatis/satu/dua, kontrol selalu tampil, bantuan gesture.
- Unduh mushaf: estimasi, berjalan, jeda, lanjut, selesai, gagal, storage penuh, hapus paket.
- Cloud opsional: manfaat/persetujuan, login, status lokal/antre/gagal/sukses, konflik posisi antarperangkat, logout, hapus data cloud.
- Loading, offline halaman belum diunduh, SVG gagal, update tersedia, ekspor/impor sukses/gagal.
- Petunjuk pertama pakai dan tampilan fokus keyboard.
- Eksplorasi P1 audio/terjemahan sebagai layar terpisah; jangan tampilkan kontrol mati pada alur P0.

### Prototype dan interaksi
Hubungkan end-to-end: buka → lanjut baca → tap toolbar → lompat surah → bookmark ayat → buka bookmark → ganti tema → unduh → lihat status offline → aktifkan sync → tangani konflik posisi.

Prototype harus menunjukkan single tap, double tap dan long press beserta tombol alternatif. Usulan: single tap toggle kontrol, double tap memilih ayat dan tindakan bookmark, long press membuka menu ayat. Jangan jadikan double tap langsung menghapus/menambah bookmark tanpa umpan balik yang jelas. Sertakan diagram state untuk membedakan gesture, panel terbuka dan zoom.

### Deliverables
1. File desain editable dengan komponen, varian, dan token warna/spacing/type/elevation/motion.
2. Frame acuan 390×844, 768×1024 dan 1024×768; tambah pengujian lebar minimum 320 CSS px.
3. Prototype semua alur P0 di atas; anotasi kondisi gagal, offline dan keyboard.
4. Spesifikasi responsive, RTL, safe area, target sentuh dan auto-hide.
5. Pemetaan tiap komponen ke state dan acceptance criteria PRD.
6. Daftar keputusan/usulan yang perlu validasi, tanpa mengubah scope diam-diam.
7. Handoff engineering: ukuran, perilaku, aset ikon, label final Indonesia dan checklist kelengkapan.

### Kriteria persetujuan desain
Semua kontrol dapat ditemukan; semua aksi gesture memiliki tombol; tiga tema memakai nilai persis; halaman tidak terpotong; dua halaman berurutan benar; bookmark ayat dan halaman berbeda jelas; offline dan sync dibedakan; seluruh empty/loading/error state tersedia; fokus dan kontras diuji; teks Quran asli tidak diubah. Desain lulus uji tugas minimal 4/5 peserta sebelum implementasi detail dikunci.

## 20. Definition of Done

- Seluruh acceptance criteria P0 yang diaktifkan pada rilis lulus dan terhubung dengan bukti QA.
- 604 halaman, metadata dan region ayat disetujui reviewer konten; sumber/lisensi tercatat.
- Bookmark/resume tetap tersedia setelah restart dan offline pada penyimpanan normal.
- Unduhan dan update dapat dipulihkan dari kegagalan tanpa kehilangan data pembaca.
- Sync opsional aman, idempoten, terisolasi per akun dan tidak memblokir membaca.
- Cakupan pengujian minimum 80% untuk kode; uji E2E dan perangkat nyata selesai.
- Tidak ada isu kritis/tinggi terbuka; tidak ada secret pada klien/repository.
- Deploy Pages, konfigurasi Worker/D1, migrasi, pemantauan kuota, backup/pemulihan dan rollback terdokumentasi.
- Keterbatasan browser, storage dan aksesibilitas yang masih ada dinyatakan jujur.

## 21. Referensi

- Percakapan proyek: Saran Quran Web App, ID 6ad68daf-7058-83ec-83ef-2c15bc7adf61; pesan pengguna yang dapat diakses dan permintaan PRD terbaru menjadi dasar kebutuhan.
- [Angular — Service Workers & PWAs](https://angular.dev/ecosystem/service-workers): perilaku offline dan dukungan browser.
- [Angular — Service worker configuration](https://angular.dev/ecosystem/service-workers/config): konfigurasi cache; pengelolaan paket unduhan khusus tetap memerlukan rancangan proyek.
- [Cloudflare — Workers limits](https://developers.cloudflare.com/workers/platform/limits/): batas layanan yang harus diperiksa pada rencana deploy.
- [Cloudflare — D1 FAQ](https://developers.cloudflare.com/d1/reference/faq/): free tier memiliki batas; jangan menjanjikan sync gratis tanpa batas.

Referensi teknis diperiksa 20 Oktober 2026. Dokumen ini menetapkan kebutuhan dan rancangan awal, bukan laporan bahwa implementasi sudah selesai.
