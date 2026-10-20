# Mushaf Digital

Aplikasi baca Al-Qur'an (PWA) yang setia pada halaman cetak **Mushaf Madinah riwayat Hafs, 604 halaman**.
Tenang, tanpa iklan, tanpa akun wajib, dan bisa dibaca offline.

- Halaman ditampilkan dari artwork SVG resmi Kompleks Percetakan Al-Qur'an Raja Fahd: tidak di-reflow,
  tidak digambar ulang, diverifikasi checksum.
- Pilih ayat dengan tap atau tekan lama lewat poligon ayat bawaan dataset. Tandai ayat atau halaman, dan
  aplikasi otomatis melanjutkan bacaan terakhir.
- Satu halaman di ponsel, dua halaman kanan-ke-kiri di tablet lanskap. Tersedia zoom, gestur, dan tombol
  alternatif untuk setiap gestur.
- 3 warna kertas × 4 gaya antarmuka.
- Sinkronisasi lintas perangkat bersifat opsional, lewat Cloudflare Worker + D1 dengan login Google.

## Struktur

| Folder | Isi |
|---|---|
| `app/` | Angular 21 PWA (standalone, zoneless, signals) untuk Cloudflare Pages |
| `worker/` | Cloudflare Worker (Hono) + D1, hanya untuk akun & sinkronisasi di `/api/*` |
| `scripts/` | Pipeline konten: unduh, validasi keamanan, checksum, metadata surah/halaman/juz |
| `docs/` | [Arsitektur](docs/ARCHITECTURE.md), [Keputusan](docs/DECISIONS.md), dan dokumen per area |
| `desain/` | Brief, PRD, tech spec, prototipe desain (acuan, read-only) |

## Menjalankan secara lokal

Butuh Node 22.12+ dan Git. Di repo ini dependensi dipasang dengan npm 11 (`npx npm@11 install`),
karena npm 10.9 bawaan Node 22.14 punya bug peer-deps.

```bash
node scripts/build-content.mjs
```

Perintah di atas mengunduh dan memverifikasi konten (±356 MB) ke `app/public/content/`. Konten tidak
di-commit; untuk percobaan cepat pakai `--pages 1-10`.

```bash
cd app && npx npm@11 install && npm start
```

Aplikasi berjalan di http://localhost:4200, dengan `/api` di-proxy ke port 8788.

Sinkronisasi bersifat opsional. Untuk menjalankan Worker lokal dengan dev-login:

```bash
cd worker && npx npm@11 install && cp .dev.vars.example .dev.vars && npm run migrate:local && npm run dev
```

## Tes

```bash
cd app && npx ng test --watch=false
```

```bash
cd worker && npm test
```

```bash
node --test scripts/test/*.test.mjs
```

## Deploy (ringkas)

1. Bangun konten dengan `node scripts/build-content.mjs --commit <sha di docs/CONTENT.md>`, lalu jalankan
   `node scripts/verify-content.mjs`.
2. Jalankan `cd app && npm run build`, lalu unggah `app/dist/mushaf/browser` ke Cloudflare Pages.
3. Untuk Worker: buat D1, terapkan migrasi, set secret Google, lalu route `<domain>/api/*`. Detailnya ada
   di [docs/worker.md](docs/worker.md).

Kuota gratis Cloudflare bisa berubah; proyek ini tidak menjanjikan hosting tanpa biaya.

## Status

Fase 1 (P0 reader lokal + infrastruktur sinkronisasi) sudah diimplementasikan. Yang belum dikerjakan dan
yang masih perlu diverifikasi tercantum di [docs/DECISIONS.md](docs/DECISIONS.md). Ringkasnya:

- Audio, terjemahan, folder penanda, layar progres, tajwid, dan riwayat lain belum ada.
- Sebelum rilis publik, dataset dan pemetaan ayat wajib ditinjau oleh penanggung jawab konten Qur'an.

## Lisensi

Kode berlisensi [MIT](LICENSE). Artwork mushaf dan metadata konten memiliki lisensinya sendiri; lihat
[NOTICE.md](NOTICE.md).
