# Pengujian API dengan Postman

Folder ini berisi koleksi Postman untuk menguji seluruh kebijakan Zero Trust pada Sistem Nilai tanpa mengetik request satu per satu.

| Berkas | Fungsi |
|---|---|
| `Zero-Trust-Sistem-Nilai.postman_collection.json` | 56 request dalam 7 folder, lengkap dengan test otomatis |
| `Zero-Trust-Lokal.postman_environment.json` | Variabel lokal: URL, secret (placeholder), token, dan ID dinamis |

Koleksi tidak memuat secret asli. Dua nilai rahasia diisi manual pada environment setelah impor.

## Prasyarat

1. Node.js 22 atau lebih baru.
2. `npm install` dan `npm run setup` sudah dijalankan sehingga file `.env` tersedia.
3. Database dimulai dari kondisi segar:

   ```bash
   # hentikan server terlebih dahulu (Ctrl+C)
   npm run seed
   npm start
   ```

4. Server berjalan di `http://127.0.0.1:3000` (gateway), `3001` (Service Nilai), dan `3002` (Service Transkrip).

## Impor dan konfigurasi

1. Buka Postman, pilih **Import**, lalu masukkan kedua berkas JSON di folder ini.
2. Pilih environment **Zero Trust Lokal** pada pojok kanan atas.
3. Buka environment tersebut dan isi:
   - `gateway_secret` dengan nilai `GATEWAY_SECRET` dari `.env`.
   - `service_client_secret` dengan nilai `SERVICE_CLIENT_SECRET` dari `.env`.
4. Biarkan nilai lain apa adanya. `service_client_id` sudah berisi `service-nilai`, dan `nilai_baru` berisi `88`.
5. Pastikan variabel `uji_jam_akses` bernilai `false` untuk pengujian normal.

Nilai token dan ID nilai diisi otomatis oleh test script, jadi tidak perlu copy-paste.

## Urutan pengujian

Jalankan **Collection Runner** dan pilih folder `00` sampai `05` secara berurutan. Folder `06` tidak perlu dicentang untuk pengujian normal.

| Folder | Cakupan | Hasil yang diharapkan |
|---|---|---|
| `00 — Autentikasi dan Token` | Login enam akun, klaim JWT, refresh, logout, token palsu | Access token 10 menit, refresh 1 hari, logout mencabut refresh |
| `01 — Nilai dan Kepemilikan Data` | Hak mahasiswa, dosen, admin; ubah nilai; nilai final; validasi 0–100 | Hanya pemilik data dan dosen pengampu yang diizinkan |
| `02 — Konteks Device dan Token` | Tanpa token, token palsu, device salah, tanpa device, header palsu, endpoint asing | Semua konteks yang tidak valid ditolak |
| `03 — Transkrip` | NIM sendiri, NIM lain, admin, dosen, NIM tidak ada | Mahasiswa hanya NIM sendiri; admin semua NIM |
| `04 — Token Service dan Finalisasi` | Token service 5 menit, pembatasan token service, finalisasi, sinkronisasi, penguncian nilai | Finalisasi berhasil dan transkrip ikut tersinkron |
| `05 — Akses Langsung ke Service` | Service tanpa secret, secret tanpa token, token salah jenis, health check | Service tidak dapat diakses langsung tanpa secret dan token yang sah |
| `06 — Jam Akses` | Ubah nilai dan finalisasi di luar jam akses | Ditolak dengan alasan "di luar jam akses" |

Pada versi ini, folder `00` sampai `05` menghasilkan **52 request** dan **115 assertion**. Semua harus berstatus hijau. Folder `06` dilewati otomatis selama `uji_jam_akses = false`.

Jika `gateway_secret` atau `service_client_secret` belum diisi, request yang membutuhkannya akan dilewati dengan pesan pada Console, bukan gagal. Isi kedua nilai tersebut agar seluruh pengujian berjalan.

Jika ingin menjalankan lewat terminal:

```bash
npx newman run postman/Zero-Trust-Sistem-Nilai.postman_collection.json \
  -e postman/Zero-Trust-Lokal.postman_environment.json
```

Namun environment yang di-commit masih berisi placeholder. Untuk Newman, buat salinan environment lokal berisi secret asli, misalnya `postman/Zero-Trust-Lokal.local.json`, lalu berikan ke opsi `-e`. Berkas `*.local.json` sudah diabaikan Git.

## Menguji jam akses (folder 06)

Folder ini harus dijalankan terpisah karena membutuhkan jendela jam akses yang tertutup.

1. Hentikan server.
2. Pada `.env`, ubah:

   ```ini
   ACCESS_START=00:00
   ACCESS_END=00:00
   ```

   Nilai awal sama dengan nilai akhir berarti jendela kosong, sehingga selalu di luar jam akses.

3. Jalankan `npm start`.
4. Pada environment Postman, ubah `uji_jam_akses` menjadi `true`.
5. Jalankan **hanya** folder `06 — Jam Akses`.
6. Setelah selesai, kembalikan `.env` menjadi `ACCESS_START=07:00` dan `ACCESS_END=21:00`, ubah `uji_jam_akses` kembali menjadi `false`, lalu hentikan server, `npm run seed`, dan `npm start`.

Hasil folder `06`: 4 request dan 9 assertion, semuanya hijau. Login dan pembacaan nilai tetap diizinkan; yang ditolak hanya perubahan dan finalisasi nilai.

## Mengembalikan data demo

Finalisasi pada folder `04` mengubah database: kelas 1 menjadi final dan transkrip bertambah. Sebelum demo atau pengujian ulang, kembalikan data:

```bash
# hentikan server
npm run seed
npm start
```

Jika `npm run seed` dijalankan saat server masih hidup, server dapat memegang koneksi database. Hentikan server terlebih dahulu.

## Penanganan masalah

| Gejala | Penyebab dan tindakan |
|---|---|
| `ECONNREFUSED` | Server belum berjalan. Jalankan `npm start`. |
| `baseUrl` tidak terdefinisi | Environment **Zero Trust Lokal** belum dipilih. |
| Request 00 gagal pada pemeriksaan environment | `gateway_secret` atau `service_client_secret` belum diisi dari `.env`. |
| `/auth/service` mengembalikan 401 | `service_client_secret` salah atau masih placeholder. |
| Ubah/finalisasi mengembalikan 403 "di luar jam akses" | Jalankan di dalam `07:00–21:00` WIB, atau atur `ACCESS_START=00:00` dan `ACCESS_END=24:00` sementara. |
| Finalisasi mengembalikan 409 "Kelas sudah difinalisasi" | Database sudah pernah difinalisasi. Hentikan server, `npm run seed`, lalu `npm start`. |
| Folder `06` tidak berjalan | `uji_jam_akses` masih `false`. Ini disengaja agar pengujian normal tidak terganggu. |

## Catatan keamanan

- Berkas environment yang di-commit hanya berisi placeholder. Secret asli tetap berada di `.env` yang tidak masuk repository.
- Password pada request adalah akun demo dari `shared/seed.js`, bukan kredensial produksi.
- Jangan menambahkan token atau secret asli ke collection. Token diisi otomatis saat runner berjalan.
- Jika membuat salinan environment dengan secret asli, gunakan nama berakhiran `.local.json` agar diabaikan Git.
