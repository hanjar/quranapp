# Catatan keputusan (ADR ringkas)

Keputusan terbuka di tech spec §10 dan PRD §18 yang diambil saat implementasi fase 1 (20 Okt 2026).
Semua bisa ditinjau ulang; ubah file ini bila keputusan berubah.

| # | Keputusan | Alasan | Status |
|---|---|---|---|
| D1 | Aset: **quranpedia/quran-svg**, `mushafs/hafs/kfqc`, dikunci ke satu commit | Satu-satunya dataset terbuka yang memuat SVG 604 halaman KFQC **dan** poligon ayat di file yang sama (geometri & versi pasti cocok). Metadata/poligon CC BY 4.0, artwork Kompleks Raja Fahd bebas untuk penggunaan digital | Perlu review konten oleh penanggung jawab Qur'an sebelum rilis publik |
| D2 | **Angular 21.2** (bukan 22) | Node lokal 22.14 di bawah minimum Angular 22 (22.22.3). Upgrade ke 22 cukup `ng update` setelah Node naik | Sementara |
| D3 | Gestur mengikuti **tech spec + prototipe**: tap ayat = pilih, tap margin = kontrol, ketuk dua kali = zoom, tekan lama = menu | PRD mengusulkan ketuk dua kali = pilih ayat; tech spec dan prototipe konsisten satu sama lain | Uji pengguna |
| D4 | Arah balik: geser kiri→kanan = halaman berikutnya; halaman ganjil di kanan dalam spread | Konvensi mushaf cetak RTL | Validasi pengguna nyata (tech spec §10) |
| D5 | Default tema: kertas **Krem Madinah #FFFDF6** (bingkai merah-emas), antarmuka **Segar** | Diminta pemilik proyek 20 Okt 2026 (sebelumnya Gading Hangat sesuai tech spec) | — |
| D6 | Tema kertas = latar CSS saja | SVG sumber tidak punya rect latar (transparan); tinta tidak pernah diwarnai ulang | Terverifikasi pada sampel hal. 1, 3, 106 |
| D7 | Bingkai biru halaman = lapisan UI (CSS) | Artwork sumber tidak memuat ornamen bingkai; tech spec: "gutters and frames belong to UI layer" | — |
| D8 | Login: **Google OIDC** (authorization code + PKCE) di Worker, sesi cookie HttpOnly di D1; `dev-login` hanya bila `DEV_AUTH=1` | Penyedia terkelola tanpa menyimpan kata sandi; tanpa biaya tambahan; mudah ditambah penyedia lain | Perlu `GOOGLE_CLIENT_ID/SECRET` saat deploy |
| D9 | API same-origin di `/api/*` (Worker route), bukan Pages Functions | Cookie SameSite=Lax tanpa CORS; aset statis tidak memakan kuota Worker | — |
| D10 | Cache halaman SVG dikelola sendiri (Cache Storage), ngsw hanya app shell + metadata | PRD §11: satu pemilik per cache; unduhan besar butuh progres/jeda/validasi | — |
| D11 | **Ditunda** dari fase 1: audio, terjemahan, layar progres/khatam, tajwid, riwayat lain (folder penanda dikerjakan di fase 2, lihat D17) | Di luar P0 tech spec/PRD (audio & terjemahan P1 butuh lisensi; progres menyimpan riwayat baca → privasi). Tidak ada tombol mati di UI | Fase berikutnya |
| D12 | Nama surah Latin = transliterasi Indonesia dari prototipe; nama Arab/jumlah ayat/halaman awal dari data sumber | Data sumber hanya punya nama Inggris | Perlu dicocokkan dengan pedoman transliterasi Kemenag |
| D13 | Batas juz dari 30 ayat awal juz Hafs kanonik, halaman diturunkan dari data halaman sumber | Tidak ada file juz di dataset | Diuji otomatis di pipeline |
| D15 | Sumber P1: audio per-ayat **Al Quran Cloud CDN** (qari awal Alafasy), terjemahan **Kemenag via Tanzil `id.indonesian`** | Disetujui pemilik proyek 20 Okt 2026 berdasar [P1-SOURCES.md](P1-SOURCES.md). Konten non-komersial; terjemahan bersifat sementara sampai ada izin tertulis LPMQ | Menunggu izin tertulis sebelum rilis publik |
| D16 | Deploy: Pages project `quran-digital` (branch produksi `production`) di **quran.hanjar.net**, Worker `mushaf-api` di route `quran.hanjar.net/api/*`, D1 `mushaf`; OAuth client "Mushaf Digital - web" di GCP project `prakasiwi` (status In production, scope dasar) | Domain milik pemilik; D1 lama `quran-db` dibiarkan kosong; header `noindex` sampai tashih | Aktif sejak 20 Okt 2026 |
| D17 | Folder penanda = koleksi/putaran khatam ("Khatam ke-N", "Ramadhan 1448 · Khatam 1"), aksi massal (pilih semua, pindah, hapus + Urungkan), catatan per penanda, halaman `/penanda`; ikut sinkron (entitas `folder`, migrasi D1 0002) | Permintaan pemilik proyek: 1–12 khatam/tahun, Ramadhan bisa 2 | Aktif sejak 20 Okt 2026 |
| D18 | Bacaan Latin per ayat = **Pedoman Transliterasi Kemenag RI**, diambil saat build dari EQuran.id API v2 (data quran.kemenag.go.id), disimpan statis `latin.json` + checksum; ditampilkan di lembar ayat dengan atribusi | Standar transliterasi resmi Indonesia; tanpa ketergantungan server pihak ketiga saat runtime | Sama seperti D15: non-komersial, menunggu izin tertulis LPMQ |
| D14 | Lisensi kode: **MIT** | Proyek open source; konten punya lisensinya sendiri (lihat NOTICE.md) | — |
