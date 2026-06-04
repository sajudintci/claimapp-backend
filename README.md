# Claimora Backend

API dan worker ekstraksi dokumen klaim asuransi (OCR ABBYY Vantage → LLM opsional → validasi billing).

## Prasyarat

- **Node.js** 20+ (disarankan LTS)
- **PostgreSQL** — skema disinkronkan saat startup (`sequelize.sync`)
- **Redis** — antrian BullMQ untuk job ekstraksi
- **ABBYY Vantage** — kredensial OCR wajib
- **OpenAI** — hanya jika `ENABLE_LLM_POST_PROCESS=true`

## Setup cepat

```bash
cd backend
cp .env.example .env
# Edit .env — isi DATABASE_URL, JWT_*, ABBYY_*, dll.

npm install
npm run dev
```

Server default: `http://localhost:4000` (lihat `PORT` di `.env`).

### Super admin (pertama kali)

Setelah DB dan Redis berjalan:

```bash
npm run seed:super-admin
```

Default (lihat `src/scripts/create-super-admin.ts`): `superadmin@claimora.local` / `SuperAdmin123!` — ganti password setelah login.

### Production

```bash
npm run build
npm run start
```

`build` mengompilasi TypeScript ke `dist/` dan menyalin prompt LLM ke `dist/modules/extraction/prompts/`.

## Scripts

| Perintah | Deskripsi |
|----------|-----------|
| `npm run dev` | API + extraction worker (hot reload) |
| `npm run build` | Compile + salin prompt |
| `npm run start` | Jalankan `dist/server.js` |
| `npm run lint` | ESLint pada `src/` |
| `npm run seed:super-admin` | Buat org/role/user super admin |
| `npm run abbyy:list-skills` | Daftar skill ID di tenant ABBYY |

## Struktur penting

```
src/
  config/env.ts          # Validasi env (Zod)
  queue/extraction-queue.ts
  modules/
    claims/              # Upload & manajemen klaim
    extraction/          # OCR, LLM, validasi
  database/              # Sequelize models & migrasi ensure-*
storage/                 # Uploads, logs (gitignored — lihat .gitignore)
documentations/          # Pipeline ekstraksi (detail teknis)
```

## Environment

Semua variabel didefinisikan di `src/config/env.ts`. Template: [`.env.example`](./.env.example).

**Jangan commit** `.env` atau isi `storage/` — sudah di `.gitignore`.

## Dokumentasi

- [documentations/README.md](./documentations/README.md) — indeks
- [documentations/extraction-pipeline.md](./documentations/extraction-pipeline.md) — alur Upload → OCR → LLM → persist

## Push ke GitHub

Pastikan sebelum commit:

1. `.env` tidak ter-track (`git status` tidak menampilkan `.env`)
2. `node_modules/`, `dist/`, dan `storage/uploads|logs|...` diabaikan
3. Hanya `.env.example` yang berisi placeholder

```bash
git init   # jika repo baru, di folder backend atau monorepo root
git add .
git status # verifikasi tidak ada secret / artefak build
```
