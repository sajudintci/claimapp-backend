# Backend documentation

Dokumentasi teknis untuk service **Claimora** (`backend/`).

## Daftar isi

| Dokumen | Deskripsi |
|---------|-----------|
| [extraction-pipeline.md](./extraction-pipeline.md) | Alur lengkap **Upload → OCR (ABBYY) → LLM → Result**, file kode, env, API, payload, troubleshooting |

## Prasyarat runtime

- PostgreSQL (`DATABASE_URL`)
- Redis (`REDIS_HOST`, `REDIS_PORT`) — BullMQ extraction worker
- ABBYY Vantage credentials — OCR wajib (local OCR sudah dihapus)
- OpenAI (opsional) — hanya jika `ENABLE_LLM_POST_PROCESS=true`

## Entry points cepat

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | API + extraction worker (via `server.ts`) |
| `npm run abbyy:list-skills` | Daftar skill ID ABBYY (jika API client diizinkan) |
| `npm run build` | Compile TS + salin prompt ke `dist/` |

## Aturan engineer

Lihat juga `.cursor/rules/claim-extraction-backend.mdc` untuk kontrak domain dan layer boundaries.
