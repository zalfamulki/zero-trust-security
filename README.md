# Sistem Nilai dengan Zero Trust Security

Tugas Praktikum Individu — Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.

API Gateway sebagai **Policy Enforcement Point (PEP)** yang terpisah dari service (NIST SP 800-207). Prinsip yang diterapkan: *never trust, always verify*, *least privilege*, *assume breach*.

| Komponen | Port | Peran | Kode |
|---|---|---|---|
| API Gateway | 3000 | PEP + Policy Engine/Administrator (login, token, keputusan allow/deny, audit log) | `gateway/src/` |
| Service Nilai | 3001 | Resource: nilai dan kelas, finalisasi | `service-nilai/src/app.js` |
| Service Transkrip | 3002 | Resource: transkrip mahasiswa | `service-transkrip/src/app.js` |
| Database SQLite | - | Satu database bersama (`data/sistem-nilai.db`) | `shared/` |

Alur: Client → Gateway (token + `X-Device-ID`) → Policy Engine (baca atribut dari database) → audit log → jika *allow*, gateway menambahkan `X-Gateway-Secret` dan meneruskan ke service → service memverifikasi secret **dan** JWT. Saat finalisasi, Service Nilai meminta token service ke gateway lalu memanggil `POST /transkrip/sinkron` **melalui gateway**.

## Prasyarat dan instalasi

- Node.js 22 atau lebih baru (diuji pada Node v24.22.1)

```bash
npm install
npm run setup     # membuat .env dengan secret acak (tidak menimpa .env yang ada)
npm run seed      # reset database dan isi data awal
npm start         # menjalankan 3 proses: gateway, service nilai, service transkrip
```

Atau jalankan tiap komponen di terminal terpisah: `npm run start:gateway`, `npm run start:nilai`, `npm run start:transkrip`.

Konfigurasi ada di `.env` (contoh: `.env.example`). `.env` tidak masuk repository. Secret asli tidak ditulis di kode.

Repositori menyertakan `.npmrc` dengan `ignore-scripts=true` karena `better-sqlite3` sudah membawa binary prebuilt. Pengaturan ini hanya melewati kompilasi native (yang membutuhkan Visual Studio C++), bukan melewati pemeriksaan keamanan aplikasi. Jika nanti menambah dependency yang memang membutuhkan install script, hapus baris tersebut.

| Variabel | Fungsi |
|---|---|
| `JWT_SECRET` | Kunci tanda tangan JWT |
| `GATEWAY_SECRET` | Nilai header `X-Gateway-Secret` |
| `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET` | Kredensial Service Nilai untuk `POST /auth/service` |
| `ACCESS_START`, `ACCESS_END`, `ACCESS_TZ` | Jam akses ubah/finalisasi nilai. Default `07:00`–`21:00`, zona `Asia/Jakarta` |
| `PORT_GATEWAY`, `PORT_NILAI`, `PORT_TRANSKRIP`, `HOST` | Port dan alamat bind |
| `DB_PATH` | Lokasi database SQLite |

**Zona waktu:** jam akses dihitung di zona `ACCESS_TZ` (default `Asia/Jakarta`), bukan zona waktu server. Rentang `[ACCESS_START, ACCESS_END)`; `00:00`–`24:00` berarti sepanjang hari, `ACCESS_START` sama dengan `ACCESS_END` berarti selalu di luar jam akses.

## Akun demo dan device ID (seed)

Password hanya untuk demo lokal. Reset kapan saja dengan `npm run seed` (hentikan server dulu).

| Role | Username | Password | X-Device-ID | NIM |
|---|---|---|---|---|
| Admin | `admin` | `admin123` | `DEV-ADMIN-01` | - |
| Dosen | `dosen1` | `dosen123` | `DEV-DSN1-01` | - |
| Dosen | `dosen2` | `dosen123` | `DEV-DSN2-01` | - |
| Mahasiswa | `mhs1` | `mhs123` | `DEV-MHS1-01` | 227006001 |
| Mahasiswa | `mhs2` | `mhs123` | `DEV-MHS2-01` | 227006002 |
| Mahasiswa | `mhs3` | `mhs123` | `DEV-MHS3-01` | 227006003 |

Kelas: `KP70065004` Keamanan Informasi (id 1, `dosen1`), `KP70012003` Jaringan Komputer (id 2, `dosen2`), `KP70011001` Algoritma dan Pemrograman (id 3, `dosen1`, sudah final dan sudah ada di transkrip). Nilai per kelas tersedia untuk ketiga mahasiswa.

## Endpoint dan kebijakan

Semua akses lewat gateway `http://127.0.0.1:3000`. Selain `/auth/*`, request user wajib membawa `Authorization: Bearer <access_token>` dan `X-Device-ID`.

| Endpoint | Diizinkan | Kondisi (diputuskan Policy Engine dari database) |
|---|---|---|
| `POST /auth/login` | Semua user | Kredensial valid dan device terdaftar untuk user tersebut |
| `POST /auth/refresh` | Semua user | Refresh token valid, belum dicabut, belum kedaluwarsa |
| `POST /auth/logout` | Semua user | Refresh token valid; setelah itu dicabut |
| `POST /auth/service` | Service Nilai | `client_id` + `client_secret` valid; token 5 menit, role `service` |
| `GET /nilai` | Mahasiswa, dosen | Mahasiswa: nilai sendiri. Dosen: kelas yang diampu (opsional `?class_id=`) |
| `PUT /nilai/:id` | Dosen | Kelas diampu, nilai belum final, dalam jam akses |
| `POST /kelas/:id/finalisasi` | Dosen | Kelas diampu, dalam jam akses; lalu sinkron transkrip |
| `GET /transkrip/:nim` | Mahasiswa, admin | Mahasiswa: NIM sendiri. Admin: semua NIM |
| `POST /transkrip/sinkron` | Hanya Service Nilai | Hanya token service; token user mana pun ditolak |

Endpoint yang tidak dikenal ditolak (default deny). Token: access JWT 10 menit (`sub`, `role`, `typ=access`), refresh token acak berlaku 1 hari (hanya hash SHA-256 disimpan di tabel `refresh_tokens`, dapat dicabut), token service 5 menit (`typ=service`, `role=service`).

## Contoh request (curl)

```bash
GW=http://127.0.0.1:3000

# Login mahasiswa
curl -s -X POST $GW/auth/login -H "Content-Type: application/json" -H "X-Device-ID: DEV-MHS1-01" \
  -d '{"username":"mhs1","password":"mhs123"}'
# 200 -> {"access_token":"...","refresh_token":"...","expires_in":600}

TOKEN=<isi access_token>

# Nilai milik sendiri
curl -s $GW/nilai -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-MHS1-01"            # 200, hanya NIM 227006001
# Transkrip NIM orang lain
curl -s $GW/transkrip/227006002 -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-MHS1-01"  # 403
# Device milik user lain
curl -s $GW/nilai -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-MHS2-01"            # 403
# Tanpa token
curl -s $GW/nilai -H "X-Device-ID: DEV-MHS1-01"                                               # 401

# Dosen ubah nilai dan finalisasi (login sebagai dosen1 dengan DEV-DSN1-01 untuk mendapat DTOKEN)
curl -s -X PUT $GW/nilai/1 -H "Authorization: Bearer $DTOKEN" -H "X-Device-ID: DEV-DSN1-01" \
  -H "Content-Type: application/json" -d '{"grade_value":90}'                                 # 200
curl -s -X POST $GW/kelas/1/finalisasi -H "Authorization: Bearer $DTOKEN" -H "X-Device-ID: DEV-DSN1-01"  # 200, tersinkron

# Akses langsung ke service (melewati gateway)
curl -s http://127.0.0.1:3001/nilai                                                           # 403 (tanpa X-Gateway-Secret)
curl -s http://127.0.0.1:3001/nilai -H "X-Gateway-Secret: <GATEWAY_SECRET dari .env>"         # 401 (secret benar, tanpa token)
```

Alternatif tanpa mengetik curl: `npm run demo` menjalankan seluruh skenario berhasil dan gagal beserta hasilnya (berguna untuk video).

## Pengujian API dengan Postman

Koleksi Postman siap impor tersedia di folder `postman/`:

- `postman/Zero-Trust-Sistem-Nilai.postman_collection.json` — 56 request dalam 7 folder, dengan test otomatis.
- `postman/Zero-Trust-Lokal.postman_environment.json` — URL lokal, token, ID dinamis, dan placeholder secret.
- `postman/README.md` — langkah impor, urutan pengujian, dan penanganan masalah.

Langkah singkat:

1. Hentikan server, jalankan `npm run seed`, lalu `npm start`.
2. Impor kedua berkas JSON ke Postman dan pilih environment **Zero Trust Lokal**.
3. Isi `gateway_secret` dan `service_client_secret` pada environment dari `.env`. Kedua nilai tidak disimpan di repository.
4. Jalankan Collection Runner untuk folder `00` sampai `05`. Folder `06` (jam akses) dijalankan terpisah saat jendela jam ditutup.
5. Setelah selesai, hentikan server, `npm run seed`, lalu `npm start` untuk mengembalikan data demo.

Token dan ID nilai diisi otomatis oleh test script. Rincian lengkap ada di `postman/README.md`.

## Pengujian

```bash
npm test
```

27 tes otomatis: 5 tes unit (jam akses, zona waktu, pencocokan route) dan 22 tes integrasi yang menjalankan tiga proses nyata pada port 13000–13002 dengan database sementara. Tes mencakup seluruh matriks pengujian tugas (login berhasil/gagal, device salah, token tanpa/palsu/kedaluwarsa, refresh/logout, hak akses per role dan kepemilikan data, nilai final, jam akses, token service, finalisasi + sinkron lewat gateway, akses langsung ke service, secret benar tanpa token, dan isi audit log).

### Sebelum demo

Demo mengubah data: finalisasi pada folder `04` membuat kelas 1 menjadi final dan menambah baris transkrip. Selalu mulai dari kondisi segar:

1. Hentikan server (`Ctrl+C`).
2. `npm run seed`
3. `npm start`

`npm run demo` sekarang memeriksa kondisi awal. Jika database sudah final seluruhnya atau request berada di luar jam akses, skrip berhenti dengan instruksi reset—bukan menampilkan skenario GAGAL yang membingungkan.

### Demo jam akses

1. Hentikan server. Di `.env` set `ACCESS_START=00:00` dan `ACCESS_END=00:00` (jendela tertutup).
2. `npm start`, lalu jalankan folder `06 — Jam Akses` pada Postman (set `uji_jam_akses=true`), atau `npm run demo -- jam` → ubah nilai dan finalisasi ditolak (403, alasan "di luar jam akses").
3. Kembalikan `.env` ke `07:00`/`21:00` (atau `00:00`/`24:00`), set `uji_jam_akses=false`, lalu jalankan ulang untuk skenario dalam jam akses.

## Audit log

Gateway mencatat setiap keputusan ke tabel `audit_logs`: waktu (UTC ISO), subjek (`user:<username>(<role>)` atau `service:<id>`), endpoint, device, hasil (`allow`/`deny`), alasan, serta method, request ID, dan status HTTP. Password, token, dan secret tidak pernah dicatat.

```bash
npm run audit          # 20 baris terakhir
npm run audit -- 50    # 50 baris terakhir
```

## Pemetaan kebutuhan ke kode (untuk video demo)

| Kebutuhan | Lokasi |
|---|---|
| Access JWT 10 menit, token service 5 menit, refresh token 1 hari | `gateway/src/services/token.service.js`, `shared/constants.js` |
| Login + cek device, refresh, logout (cabut), `/auth/service` | `gateway/src/routes/auth.routes.js` |
| Verifikasi token di gateway | `gateway/src/middleware/authenticate.js` |
| Policy Engine: role, kepemilikan, status final, device, jam akses | `gateway/src/policy.js` |
| PEP: tolak sebelum diteruskan, catat keputusan | `gateway/src/middleware/protect.js`, `gateway/src/app.js` |
| `X-Gateway-Secret` ditambahkan gateway saat meneruskan | `gateway/src/app.js` (`proxyReq`) |
| Jam akses dapat dikonfigurasi, zona waktu eksplisit | `shared/time.js`, `.env` |
| Audit log | `gateway/src/middleware/audit.js`, tabel `audit_logs` |
| Service memverifikasi gateway secret **dan** token (tanda tangan, masa berlaku, jenis, role) | `shared/verify.js` (dipakai kedua service) |
| Finalisasi → token service → sinkron lewat gateway | `service-nilai/src/app.js` |
| `/transkrip/sinkron` hanya token service | `service-transkrip/src/app.js`, `gateway/src/policy.js` |
| Schema, relasi, seed | `shared/schema.sql`, `shared/seed.js` |

## Catatan desain

- Gateway secret **bukan** pengganti token: kedua service menolak request tanpa token valid walaupun secret benar. Health check service (`/health`) juga mewajibkan secret.
- Service memeriksa ulang kepemilikan data dari database dan jam akses (pertahanan berlapis), tidak hanya mengandalkan keputusan gateway.
- Gateway menimpa `X-Gateway-Secret` dari client sehingga nilai kiriman client tidak pernah dipercaya.
- Finalisasi bersifat konsisten: jika sinkronisasi ke transkrip gagal, finalisasi dibatalkan (status final dikembalikan) sehingga nilai dan transkrip tidak berselisih. Sinkronisasi hanya diterima untuk nilai yang sudah final dan sama dengan data di database.
- Pesan error login tidak membedakan "user tidak ada" dan "password salah". Refresh token disimpan sebagai hash.
- Frontend tidak dibuat karena tidak diwajibkan; pengujian lewat curl/Postman atau `npm run demo`.
