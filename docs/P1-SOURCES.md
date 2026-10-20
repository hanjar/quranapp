# P1 — Riset sumber audio & terjemahan

Status: **riset saja** (20 Okt 2026), belum ada keputusan/kode. Tindak lanjut D11 di `DECISIONS.md`.
Syarat PRD (§8, §16): lisensi redistribusi terverifikasi, timing ayat tervalidasi (bukan perkiraan), kontrol offline,
atribusi sumber, ID ayat `surah:ayat` (Hafs, 6236 ayat). Terjemahan **tidak boleh** dibuat AI.

Semua temuan di bawah diuji langsung (curl / fetch) pada 20 Okt 2026 kecuali ditandai **[belum terverifikasi]**.
Kutipan lisensi dipersingkat. Ini bukan nasihat hukum.

## 1. Ringkasan rekomendasi

| | Rekomendasi | Status lisensi |
|---|---|---|
| **Audio** | Per-ayah MP3 dari **CDN Al Quran Cloud / Islamic Network** (`cdn.islamic.network`), qari awal **Alafasy** (+ Husary, Minshawi, Abdul Basit bila perlu). Satu file = satu ayat, jadi pemetaan `surah:ayat` pasti tanpa data timing tambahan. | Ada syarat tertulis yang eksplisit, tapi hak cipta tetap pada qari (lihat risiko) |
| **Terjemahan** | **Terjemahan Kemenag RI** (Bahasa Indonesia) dari berkas statis **Tanzil `id.indonesian`** (6236 baris, verbatim). Perlakukan **sementara**: minta izin tertulis LPMQ/Kemenag sebelum rilis publik. | Tanzil: non-komersial + tautan balik. Hak cipta teks Kemenag sendiri **tidak ada pernyataan lisensi terbuka** |

Tidak ada kandidat yang berlisensi terbuka bersih (CC/MIT) untuk audio maupun terjemahan Kemenag. Risiko lisensi
tidak bisa dihilangkan lewat teknis; perlu keputusan pemilik proyek (§6).

## 2. Audio — perbandingan kandidat

| Kandidat | URL | Lisensi / syarat (kutipan) | Redistribusi / cache offline | Atribusi | Format & ukuran | ID ayat & timing | API/statis & CORS |
|---|---|---|---|---|---|---|---|
| **A. Al Quran Cloud CDN** (rekomendasi) | `https://cdn.islamic.network/quran/audio/{bitrate}/{edition}/{n}.mp3`; daftar edisi `https://api.alquran.cloud/v1/edition/format/audio` (190 edisi, ±20 qari per-ayat); <https://alquran.cloud/terms-and-conditions> | "Recitations are licensed to us by the reciters or their estates for free, non-commercial redistribution…You may stream, embed and download them for personal and educational use. You may bundle them into a commercial product, but please note that copyrights lie with the reciters and they may ask you to remove the content." / "All audio files … retain their respective copyrights." API "free and key-less". | Streaming/unduh untuk pribadi & edukasi: boleh. "please cache aggressively at your own edge" (tidak ada throttle CDN). Unduh paket offline oleh pengguna sesuai klausa "download". Jangan commit MP3 ke repo. | "please attribute the translator by name" (terjemahan); untuk audio hanya hak cipta qari dipertahankan → tampilkan nama qari + "Sumber: Islamic Network / Al Quran Cloud". | MP3. Bitrate 192/128/64/48/40 (32 tidak ada: balasan 271 B). Alafasy ayat 1:1 = 146 KB @128, 49,5 KB @64. Estimasi seluruh Quran ≈ 170–220 MB @64 dan 350–450 MB @128 (**estimasi, ukur aktual sebelum rilis**). | Nomor global **1–6236** (`/262.mp3`), bukan `surah:ayat`; pemetaan lewat tabel kumulatif jumlah ayat (kita sudah punya `surahs.json`). Satu file per ayat → tidak perlu timing. Ada pula file per-surah `/audio-surah/{bitrate}/{edition}/{1-114}.mp3` tanpa timing. | CDN statis nginx/S3; HTTP Range didukung; **tidak ada header `Access-Control-Allow-Origin`** → `<audio src>` jalan, tetapi `fetch()` untuk cache offline akan *opaque*/gagal; perlu proxy (Worker) atau pindah ke sumber B. |
| **B. EveryAyah.com** | `https://everyayah.com/data/{Qari}/{SSSAAA}.mp3`, mis. `Alafasy_128kbps/001001.mp3`; metadata `https://everyayah.com/data/recitations.js`; berkas timing `…/data/timings_files/`, `…/data/XML/` | Tidak ada halaman syarat di situs. Satu-satunya pernyataan yang ditemukan pihak ketiga: wajib "link back to our site" untuk memakai timing; tautan lisensi di disklaimer itu sudah mati; cermin Hugging Face menandai lisensi koleksi **tidak jelas/UNKNOWN** (sumber sekunder). | **Tidak ada izin tertulis** → tidak aman untuk bundling/cache terkelola tanpa konfirmasi (kontak: quran.zendesk.com). Teknis tidak dibatasi. | Tautan balik ke everyayah.com (menurut sumber sekunder). | MP3, banyak bitrate (mis. 64/128 kbps), 6236 file/qari. Ayat 1:1 Alafasy 128 = 146.830 B (byte identik dengan sumber A → kemungkinan satu asal rekaman). | **Penamaan `SSSAAA` = `surah:ayat` langsung** (Hafs 6236). Satu file per ayat; ada file timing untuk per-surah/halaman. | Statis (BunnyCDN); **`Access-Control-Allow-Origin: *`** + Range → cache offline via `fetch` bisa. |
| **C. Quran.com / Quran Foundation (verses.quran.com, QDC)** | `https://api.quran.com/api/v4/recitations/{id}/by_ayah/{s:a}` → path `Alafasy/mp3/001001.mp3` pada `https://verses.quran.com/`; per-surah dengan timing: `https://api.quran.com/api/v4/chapter_recitations/{rid}/{surah}?segments=true` | Ketentuan layanan quran.com (T&C) melarang "modification, adaptation… translation or derivative work from the Mobile Application or Service" dan menghapus tanda hak cipta; tidak ada lisensi eksplisit untuk audio/konten via API publik. Dokumentasi resmi Quran Foundation (api-docs.quran.foundation) mengarah ke akses ber-OAuth ("Request Access") untuk API produksi; `api.quran.com/api/v4` publik masih menjawab tanpa kunci tapi **tidak ada jaminan/ SLA tertulis** (sempat 503 saat uji). | Tidak ada pernyataan. Anggap **tidak diizinkan** untuk cache offline tanpa konfirmasi. | Tidak ditentukan. | Per-ayat MP3 sama dengan A/B (`Alafasy/mp3/001001.mp3`, 146.830 B). Per-surah (mis. `qdc/mishari_al_afasy/murattal/1.mp3` ± 840 KB untuk Al-Fatihah) di `download.quranicaudio.com`. | **Satu-satunya sumber dengan timing per ayat *dan per kata*** (`timestamps[].verse_key`, `timestamp_from/to` ms, `segments [[kata, mulai, selesai]]`) → cocok untuk gapless/penyorotan kata di P1.5. `verse_key` = `s:a`. Catatan: ada segmen kosong `[1]` pada beberapa kata (data tak lengkap) → wajib divalidasi. `?segments=true` pada endpoint per-ayat **tidak** menghasilkan timing (hanya path file). | API REST JSON, `access-control-allow-origin: *`, cache publik; audio CDN juga ACAO `*`. |
| **D. QuranicAudio.com** | `https://download.quranicaudio.com/…` | "Mp3s on this site may be downloaded and used for personal use free of charge … you may not use these files for commercial purposes." | Pribadi saja; redistribusi oleh aplikasi pihak ketiga tidak dinyatakan. | — | Per-surah MP3. | Per-surah, tanpa timing publik. | Statis. |
| **E. King Fahd Complex (qurancomplex.gov.sa)** | <https://qurancomplex.gov.sa/en/?p=3979> | Menurut hasil pencarian (kutipan sekunder, **[belum terverifikasi]**; situs tidak dapat dijangkau dari mesin riset): menyediakan rekaman "for their free general use in computer apps, broadcasting channels, internet websites, and for use in government and private sectors". | Pernyataan paling permisif dari semua kandidat, kemungkinan mencakup bundling. Perlu dibaca langsung dan disimpan salinannya. | Perlu dicek. | Format/struktur per-ayat & daftar qari belum diketahui. | Belum diketahui apakah per-ayat/ada timing. | — |

Catatan teknis penting:
- **Per-ayat vs timing.** PRD menolak timing hasil perkiraan. Dengan file satu-ayat-satu-MP3, "timing" adalah batas
  file itu sendiri (pasti, bukan perkiraan); perpindahan ayat = event `ended` + preload ayat berikut. Jeda antar-ayat
  dan basmalah: pada sumber A/B/C ayat 1:1 berisi basmalah; ayat pertama surah lain umumnya tidak (validasi manual per qari).
  Timing per-ayat/per-kata dari C hanya diperlukan jika ingin audio gapless per surah atau sorotan kata.
- **Penomoran.** A memakai nomor global 1–6236 (= urutan Hafs), B memakai `SSSAAA`, C memakai `verse_key`. Semuanya Hafs 6236;
  uji otomatis di pipeline: jumlah file per surah = `ayahCount` (B menyediakan `recitations.js` berisi `ayahCount`).
- **CORS.** Hanya B dan C yang memberi `ACAO: *`. Jika memilih A dan ingin cache offline lewat `fetch`, perlu proxy/Worker
  (menambah beban + masalah redistribusi), atau gunakan `<audio>` biasa untuk streaming dan tunda fitur unduh offline.

## 3. Terjemahan Indonesia — perbandingan kandidat

| Kandidat | URL | Lisensi / syarat (kutipan) | Redistribusi / offline | Atribusi | Format & ukuran | ID ayat | API/statis & CORS |
|---|---|---|---|---|---|---|---|
| **T1. Tanzil `id.indonesian`** (rekomendasi, sementara) | <https://tanzil.net/trans/?transID=id.indonesian&type=txt> (juga `type=txt-2`: `s\|a\|teks`, `xml`, `sql`) | "The translations provided at this page are for non-commercial purposes only. If used otherwise, you need to obtain necessary permission from the translator or the publisher." "If you are using more than three of the following translations … we require you to put a link back to this page." "Redistributing the following list in another website is not allowed, unless direct permission is granted." Header berkas: Name *Bahasa Indonesia*; Translator *Indonesian Ministry of Religious Affairs*; Last Update **June 4, 2010**. | Boleh disimpan/dicache untuk aplikasi non-komersial (satu terjemahan, bukan "daftar"). Unduh saat build seperti pola `docs/CONTENT.md`; tidak commit ke repo (konsisten dengan NOTICE). | Sebut "Terjemahan Kemenag RI via Tanzil.net" + tautan ke tanzil.net. Tautan balik wajib bila >3 terjemahan. | Teks UTF-8; 6236 baris non-komentar, 1,1 MB (±350 KB gzip, estimasi). `txt-2` = `surah\|ayat\|teks` (urutan Hafs). | `surah:ayat` eksplisit pada `txt-2`/xml/sql; 6236 baris terverifikasi. | Berkas statis (unduh saat build). Tanzil tidak dimaksudkan sebagai CDN runtime. |
| **T2. Quran.com API resource 33** | `https://api.quran.com/api/v4/quran/translations/33` (`?verse_key=2:255`) | Nama sumber: "Indonesian Islamic Affairs Ministry", author "Unknown", info kosong. Tanpa pernyataan lisensi. Kata-kata ayat berbeda dari Tanzil ("Maha Pengasih, Maha Penyayang" vs "Maha Pemurah lagi Maha Penyayang"), jadi ini **revisi Kemenag yang lebih baru**; tidak ada metadata edisi/tahun. | Tidak dinyatakan; T&C quran.com melarang "derivative work". | Tidak ditentukan. | JSON, 6236 entri (`resource_id`, `text`). | `verse_key` s:a via parameter. | REST publik; ACAO `*`; tak ada jaminan (sempat 503). |
| **T3. Al Quran Cloud edisi `id.indonesian`** | `https://api.alquran.cloud/v1/ayah/1:1/id.indonesian` | Teks sama dengan Tanzil (edisi 2010). Syarat: "Translations are contributed by their rights-holders or sourced from public-domain editions … please attribute the translator by name." — klaim ini **tidak akurat/terverifikasi** untuk Kemenag (bukan domain publik). Edisi Indonesia lain: `id.muntakhab` (Quraish Shihab), `id.jalalayn` (tafsir). | Kunci tidak perlu; cache disarankan. | Sebut penerjemah. | JSON. | `surah:ayah` di path. | REST publik. |
| **T4. Tanzil `id.muntakhab` / `id.jalalayn`** | `https://tanzil.net/trans/id.muntakhab` | Syarat Tanzil sama (non-komersial). Muntakhab = tafsir ringkas (Quraish Shihab dkk), Jalalayn = tafsir klasik; bukan terjemahan Kemenag. | Sama dengan T1. | Sama. | Teks. | `s\|a\|teks`. | Statis. |
| **T5. Quran Kemenag resmi** | <https://quran.kemenag.go.id/> | Situs/aplikasi (LPMQ Kemenag); **tidak ada halaman syarat lisensi publik** yang ditemukan; `/api/v1/…` tidak mengembalikan JSON (SPA). Pencarian tidak menemukan kebijakan penggunaan ulang. | **Tidak ada izin**; scraping tidak dianjurkan. | — | — | — | Tanpa API publik terdokumentasi. |
| **T6. Kandidat lain (tidak dipilih)** | KFGQPC edisi Indonesia via Quran.com (id 134), "The Sabiq Company" (id 141) | Terjemahan penerbit/komplek lain, bukan Kemenag; syarat tidak dinyatakan. | — | — | — | — | Tersedia di API Quran.com. |

Catatan: fawazahmed0/quran-api (Unlicense, jsDelivr) menyebut sebagian terjemahan hasil OCR dan tidak mendaftarkan
edisi Indonesia pada README yang dapat dibaca (perlu cek `editions.json`); Unlicense di repo tidak otomatis melepas hak cipta
terjemahan di dalamnya, jadi tidak dipakai sebagai dasar lisensi.

## 4. Rekomendasi

### Audio — A (CDN Islamic Network), cadangan B bila perlu `fetch`
Alasan:
1. Satu-satunya sumber dengan syarat tertulis jelas yang menyebut *stream, embed, download*, caching, dan atribusi.
2. Per-ayat → pemetaan `surah:ayat` deterministik, tanpa timing perkiraan (memenuhi PRD).
3. Banyak qari ayat-per-ayat dalam satu skema URL dan beberapa bitrate (64 kbps cukup untuk HP, ukuran terkendali).
4. Dikelola organisasi yang sama dengan API (stabil, tanpa kunci).

Risiko:
- **Hak cipta qari tetap pada qari/ahli waris** dan "they may ask you to remove the content" → jangan commit atau bundle; ambil dari CDN pada runtime, simpan dalam Cache Storage hanya atas aksi pengguna (paket unduhan), siapkan cara cepat menonaktifkan qari lewat manifest.
- **Tidak ada CORS** → unduh offline via `fetch` tidak jalan langsung; opsi: (a) streaming saja di P1, offline di P1.5; (b) Worker proxy (perlu cek kebolehan); (c) pindah/ganti ke B setelah ada konfirmasi tertulis.
- Klaim "kami berlisensi dari qari" tidak dapat diverifikasi dari luar; asal rekaman sama dengan EveryAyah/GlobalQuran (byte identik 1:1), yang lisensinya tidak jelas.
- Syarat tertulis terbarunya bertanggal 14 Juni 2026 dan bisa berubah → simpan salinan (arsip) pada saat keputusan.
- Basmalah/jeda berbeda antar qari dan ayat pertama surah → perlu QA manual per qari (PRD §16).

### Terjemahan — T1 (Tanzil `id.indonesian`, Kemenag), bersyarat izin
Alasan: satu-satunya berkas statis dengan `surah:ayat` pasti, 6236 baris terverifikasi, sumber terdeklarasi (Kemenag RI), dan syarat singkat yang bisa dipenuhi (non-komersial + tautan). Bisa diunduh saat build seperti SVG sehingga tidak ada runtime dependency.

Risiko:
- **Edisi 2010 (lama)**; Kemenag sudah merevisi (Quran.com id 33 / aplikasi Kemenag memakai redaksi baru, mis. "Maha Pengasih"). Bila pemilik ingin edisi mutakhir, perlu sumber resmi Kemenag.
- Tanzil sendiri hanya "mostly acceptable… cannot guarantee their authenticity" dan melimpahkan izin ke penerjemah/penerbit jika dipakai di luar non-komersial. Hak cipta Kemenag (UU Hak Cipta: karya instansi pemerintah ≠ otomatis domain publik) tidak diklarifikasi di mana pun.
- Larangan komersial: proyek MIT tetapi kontennya non-komersial; jangan ada iklan/berbayar yang membawa konten ini (cocokkan dengan NOTICE).
- Alihkan sumber ke berkas statis bila Tanzil memindah URL; simpan checksum di pipeline.

## 5. Implikasi implementasi (untuk fase berikutnya, bukan sekarang)
- Pipeline build: unduh `txt-2` Tanzil → `translation-id.json` (kunci `"s:a"`), uji 6236 entri + jumlah per surah = `surahs.json`; masuk daftar di `NOTICE.md`.
- Audio: modul `AudioSource` dengan peta nomor-global dari `surahs.json`; konfigurasi qari di manifest yang bisa dimatikan tanpa rilis ulang.
- Offline: terjemahan ikut paket unduhan (kecil); audio unduhan opsional per surah/qari dengan ukuran ditampilkan (PRD §Offline).
- Atribusi di layar Tentang: nama qari + sumber, "Terjemahan Kemenag RI via Tanzil.net".

## 6. Pertanyaan terbuka untuk pemilik proyek
1. **Komersialisasi:** apakah proyek akan tetap non-komersial seterusnya (tanpa iklan, donasi, atau fitur berbayar)? Ini menentukan apakah syarat Tanzil dan sebagian audio terpenuhi.
2. **Izin tertulis:** siap menghubungi LPMQ Kemenag (terjemahan) dan Islamic Network (`contact` di alquran.cloud) atau Quran Foundation untuk konfirmasi tertulis? PRD §Risiko meminta verifikasi tertulis sebelum distribusi.
3. **Edisi terjemahan:** terima edisi 2010 (Tanzil) untuk P1, atau tunggu/ajukan edisi Kemenag terbaru?
4. **Qari awal:** Alafasy saja, atau daftar (mis. Husary, Minshawi, Abdul Basit, Sudais, Syuraim)? Tiap qari = tambahan QA basmalah/jeda dan ±200–450 MB data unduhan.
5. **Offline audio:** wajib di P1? Bila ya, pilih: ganti ke EveryAyah (CORS, lisensi tak jelas), proxy via Worker, atau tunda ke P1.5.
6. **Timing/kata-per-kata:** apakah audio gapless per surah atau sorotan kata dibutuhkan? Itu memaksa memakai data Quran Foundation (segmen) yang memerlukan validasi tambahan dan konfirmasi lisensi.
7. **Bitrate default:** 64 kbps (hemat) atau 128 kbps (kualitas)?
8. **King Fahd Complex:** bersedia memverifikasi halaman lisensi mereka (tidak terjangkau dari mesin riset ini) sebagai sumber audio utama yang lebih bersih lisensinya?

## 7. Sumber
- Al Quran Cloud: <https://alquran.cloud/terms-and-conditions>, <https://alquran.cloud/cdn>, <https://api.alquran.cloud/v1/edition/format/audio>
- Tanzil: <https://tanzil.net/trans/>, <https://tanzil.net/download/>
- EveryAyah: <https://everyayah.com/>, <https://everyayah.com/data/recitations.js>
- Quran.com API: <https://api.quran.com/api/v4/resources/recitations>, <https://quran.com/terms-and-conditions>, <https://api-docs.quran.foundation/>
- QuranicAudio: <https://www.quranicaudio.com/about>
- King Fahd Complex: <https://qurancomplex.gov.sa/en/?p=3979> (tidak terjangkau saat riset)
- Kemenag: <https://quran.kemenag.go.id/>
