# Loop Countdown

Timer hitung mundur berulang berbasis Cloudflare Workers dan Durable Objects. Status timer disimpan di Durable Object sehingga timer tetap berjalan walaupun tidak ada halaman yang sedang terbuka.

## Prasyarat

- Node.js dan npm
- Akun Cloudflare
- Wrangler, dijalankan melalui `npx`

## Menjalankan Secara Lokal

1. Masuk ke folder proyek:

   ```bash
   cd COUNTDOWN
   ```

2. Jalankan server development:

   ```bash
   npx wrangler dev
   ```

3. Buka URL yang ditampilkan Wrangler, biasanya `http://localhost:8787`.

Pada mode lokal, Durable Object menggunakan penyimpanan lokal Wrangler.

## Password Kontrol

Endpoint untuk mengubah timer membutuhkan secret `PASSWORD`. Buat secret untuk environment lokal dengan perintah berikut:

```bash
npx wrangler secret put PASSWORD --local
```

Untuk deployment Cloudflare, gunakan tanpa `--local`:

```bash
npx wrangler secret put PASSWORD
```

Masukkan password saat Wrangler memintanya. Jangan menyimpan password di dalam source code atau commit file secret.

## Deploy ke Cloudflare

Login ke Cloudflare terlebih dahulu jika belum pernah dilakukan:

```bash
npx wrangler login
```

Setelah secret production dibuat, deploy dengan:

```bash
npx wrangler deploy
```

Nama Worker mengikuti konfigurasi di `wrangler.jsonc`, yaitu `loop-countdown`.

## Penggunaan Web

- Buka URL Worker.
- Endpoint baca timer langsung tersedia tanpa login.
- Masukkan password kontrol untuk membuka tombol `Start`, `Stop`, `Reset`, koreksi waktu live, dan pengaturan durasi.
- Durasi diatur dalam jam, menit, dan detik.
- Klik `Kunci kontrol` untuk menghapus password dari browser.

Password yang dimasukkan disimpan di `localStorage` browser sampai kontrol dikunci atau password dinyatakan salah.

## API

Semua response JSON menggunakan `Content-Type: application/json`. Endpoint `/api/time` tidak memerlukan autentikasi.

### Membaca status timer

```http
GET /api/time
```

Contoh response:

```json
{
  "running": true,
  "duration_ms": 60000,
  "elapsed_ms": 12000,
  "remaining_ms": 48000,
  "remaining_seconds": 48,
  "formatted": "00:00:48",
  "cycle": 1,
  "progress": 0.2,
  "server_time": 1735689600000
}
```

Untuk mendapatkan sisa waktu sebagai plain text:

```http
GET /api/time?format=text
```

### Login kontrol

```bash
curl -X POST http://localhost:8787/api/login \
  -H "Authorization: Bearer PASSWORD_ANDA"
```

### Mengontrol timer

Ganti `http://localhost:8787` dengan URL Worker production setelah deploy.

```bash
curl -X POST http://localhost:8787/api/start \
  -H "Authorization: Bearer PASSWORD_ANDA"

curl -X POST http://localhost:8787/api/stop \
  -H "Authorization: Bearer PASSWORD_ANDA"

curl -X POST http://localhost:8787/api/reset \
  -H "Authorization: Bearer PASSWORD_ANDA"
```

### Koreksi waktu tanpa menghentikan timer

Endpoint `/api/adjust` menggeser posisi countdown saat timer tetap berjalan.

- Nilai positif memajukan countdown sehingga sisa waktu berkurang.
- Nilai negatif memundurkan countdown sehingga sisa waktu bertambah.
- Nilai yang diterima adalah `-3600` sampai `3600`, kecuali `0`.

```bash
curl -X POST http://localhost:8787/api/adjust \
  -H "Authorization: Bearer PASSWORD_ANDA" \
  -H "Content-Type: application/json" \
  -d '{"seconds":1}'
```

Contoh `{"seconds":1}` memajukan countdown 1 detik, sedangkan `{"seconds":-1}` memundurkannya 1 detik.

### Mengatur durasi

Nilai `seconds` harus berada antara `1` dan `8640000`.

```bash
curl -X POST http://localhost:8787/api/duration \
  -H "Authorization: Bearer PASSWORD_ANDA" \
  -H "Content-Type: application/json" \
  -d '{"seconds":60}'
```

Durasi juga dapat dikirim melalui query string:

```http
GET /api/duration?seconds=60
```

## Struktur Proyek

```text
.
├── src/
│   └── index.js       # Worker, Durable Object, UI, dan endpoint API
├── wrangler.jsonc     # Konfigurasi Wrangler dan Durable Object
└── README.MD
```

## Catatan

- Timer menggunakan waktu server, bukan interval browser, sehingga perhitungan tetap konsisten.
- Semua instance timer memakai Durable Object dengan nama `main`, jadi aplikasi ini menggunakan satu timer bersama.
- CORS saat ini mengizinkan semua origin (`*`).
