# Arsitektur — Mushaf Digital

Ringkasan teknis untuk kontributor. Kebutuhan produk ada di `desain/01_TECH_SPEC (1).md`
dan `desain/PRD-Quran-Web-App.md`; acuan visual ada di `desain/Mushaf Digital.dc.html`.
Keputusan yang diambil saat implementasi tercatat di [DECISIONS.md](DECISIONS.md).

```text
quran/
├── app/        Angular 21 PWA (standalone, zoneless, signals) → Cloudflare Pages (statis)
├── worker/     Cloudflare Worker (Hono) + D1 → hanya /api/* untuk akun & sinkronisasi
├── scripts/    Pipeline konten: unduh, validasi, checksum, turunkan metadata
├── docs/       Dokumentasi per area
└── desain/     Brief, PRD, tech spec, prototipe Claude Design (read-only)
```

## Alur data

```text
quranpedia/quran-svg @ commit terkunci
        │  scripts/build-content.mjs (validasi keamanan + integritas, tanpa mengubah glyph)
        ▼
app/public/content/hafs-kfqc/{edition,surahs,pages,juz,manifest}.json + svg/NNN.svg
        │  Cloudflare Pages (CDN)
        ▼
ContentService ── Cache Storage "mushaf-pages-<versi>" (dikelola sendiri, bukan ngsw)
        │
ReaderShell / PageView ── SVG inline + .ayahPolygon sebagai hit-region ayat
        │
UserDataService ── IndexedDB (Dexie): bookmarks, positions, prefs, outbox, sync, meta
        │  (hanya bila sinkronisasi aktif)
SyncService ── fetch /api/v1 ── Worker ── D1
```

## Lapisan aplikasi (`app/src/app`)

| Area | Lokasi | Isi |
|---|---|---|
| Kontrak beku | `core/models.ts`, `core/contracts.ts`, `core/storage/db.ts` | Tipe domain, abstract service (juga token DI), skema IndexedDB |
| State UI lintas fitur | `core/reader-ui.service.ts` | halaman aktif, sheet, ayat terpilih, toast, zoom |
| Tema | `core/theme.service.ts`, `src/styles.scss` | 3 tema kertas × 4 tema antarmuka lewat atribut `data-*` di `<html>` |
| Konten | `core/content/` | metadata, ambil + verifikasi SHA-256 + cache halaman SVG, prefetch ±2 |
| Offline | `core/offline/` | paket 604 halaman eksplisit: jeda/lanjut/retry/hapus |
| Data pengguna | `core/storage/` | posisi, penanda, preferensi, ekspor/impor, outbox |
| Sinkronisasi | `core/sync/` | outbox → `/sync/batch`, tarik `/sync`, konflik posisi, backoff |
| Pembaca | `features/reader/` | shell, render halaman, gesture controller murni, chrome, zoom |
| Sheet | `features/sheets/` | ayat, daftar isi, penanda, cari, pengaturan, offline, akun, tentang |
| Onboarding & shell | `features/onboarding/`, `features/shell/` | sambutan, tur gestur, toast |

URL adalah sumber kebenaran halaman aktif: `/hal/:page`. Rute `/` mengarahkan ke posisi terakhir
(atau `/selamat-datang` pada kunjungan pertama). Deep link eksplisit mengungguli posisi tersimpan (US-02).

## Prinsip integritas teks

- SVG disalin byte-per-byte dari sumber; tidak ada reflow, redraw, filter warna, atau penghapusan elemen.
- Validasi keamanan saat build (script/foreignObject/handler/referensi eksternal → build gagal) dan
  sekali lagi saat runtime sebelum disisipkan ke DOM.
- Setiap halaman diverifikasi SHA-256 terhadap `manifest.json`; gagal verifikasi → halaman tidak
  ditampilkan (tidak ada sumber pengganti).
- Tema hanya mengganti latar kertas (SVG transparan); tinta asli `#231f20` tidak disentuh.
- Sorotan ayat = isi transparan pada poligon ayat yang sudah ada, bukan mengubah glyph.

## Offline & cache

- **ngsw** (Angular service worker) memiliki app shell + metadata JSON + ikon.
- **ContentService/OfflineService** memiliki cache halaman SVG (`mushaf-pages-<contentVersion>`):
  halaman terbaca disimpan otomatis (dibatasi LRU), unduh penuh 604 halaman adalah aksi eksplisit
  yang "menyematkan" cache. Satu pemilik per cache, sesuai PRD §11.
- Balik halaman tidak pernah memanggil Worker.

## Sinkronisasi (opsional)

Local-first: tulis ke IndexedDB + outbox dalam satu transaksi → Worker menerapkan batch idempoten
(`opId`), revisi server monoton per pengguna, tombstone untuk hapus, dedupe kunci semantik, konflik
`baseRev` usang. Posisi baca berbeda antarperangkat tidak memindahkan pembaca: pengguna memilih
"Gunakan posisi perangkat ini" / "Gunakan posisi cloud". Detail kontrak: `docs/worker.md` dan
`docs/sync-client.md`.

## Deploy

- `app/`: `npm run build` → `app/dist/mushaf/browser` ke Cloudflare Pages (`_headers`, `_redirects` ikut).
  Konten dibangun dulu dengan `node scripts/build-content.mjs` (tidak di-commit; ±300 MB).
- `worker/`: `wrangler deploy` dengan route `<domain>/api/*` pada domain yang sama dengan Pages.
- Kuota gratis Cloudflare dapat berubah; tidak ada janji biaya nol.
