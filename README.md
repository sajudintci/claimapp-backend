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

## Docker

```bash
cd backend
docker build -t claimora-backend .
docker run -p 4000:4000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/claimora \
  -e JWT_SECRET=... -e JWT_REFRESH_SECRET=... \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 \
  -e ABBYY_CLIENT_ID=... -e ABBYY_CLIENT_SECRET=... -e ABBYY_SKILL_ID=... \
  -v claimora-storage:/app/storage \
  claimora-backend
```

**Coolify (folder `backend/`):** Base Directory = `backend`, Dockerfile = `Dockerfile`.

1. **Environment** — salin variabel dari `.env.example` ke tab **Environment** di Coolify (bukan file `.env` di repo; file itu tidak masuk image).
2. **PostgreSQL** — `DATABASE_URL` harus mengarah ke database yang **sudah ada**. Contoh Coolify internal:
   `postgres://postgres:PASSWORD@postgres-service-name:5432/postgres`
   Jika URL berakhir dengan `/claimora`, buat dulu database tersebut di Postgres:
   `CREATE DATABASE claimora;`
   Error `3D000` / `SequelizeConnectionError` = nama database di URL tidak ditemukan.
3. **Redis** — `REDIS_URL=redis://user:pass@redis-host:6379/0` atau `REDIS_HOST` + `REDIS_PASSWORD`.
4. **Volume** — mount `/app/storage` untuk upload dokumen.
5. Jangan set secret (`JWT_*`, `OPENAI_*`, `ABBYY_*`) sebagai **build** env — hanya **runtime**.

Satu container menjalankan API + worker ekstraksi (BullMQ). PostgreSQL dan Redis harus reachable dari container (hostname service Coolify, bukan `localhost`).

## Scripts

| Perintah | Deskripsi |
|----------|-----------|
| `npm run dev` | API + extraction worker (hot reload) |
| `npm run build` | Compile + salin prompt |
| `npm run start` | Jalankan `dist/server.js` (dengan path alias `@/`) |
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
