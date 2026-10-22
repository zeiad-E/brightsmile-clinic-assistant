# Infra

Local supporting services for CareDesk.

## Services

- **llm-engine** (`:3001`) — the OpenAI-compatible LLM gateway ([freellmapi](https://github.com/tashfeenahmed/freellmapi)) that fans requests across free providers with automatic failover. The backend talks to it via `LLM_ENGINE_BASE_URL`.
- **n8n** (`:5678`) — automation (booking confirmations, staff alerts). Optional.

## Run

```bash
cd infra
docker compose up -d
```

Then add your free provider keys in the engine dashboard at `http://localhost:3001`, and point the backend's `.env` `LLM_ENGINE_BASE_URL` at `http://localhost:3001/v1`.

> Note on the exact image/build command for the engine: follow the upstream repo's README (Docker / compose instructions may differ). The `image:` line above is a placeholder to confirm during setup.

## Deployment (free)

- Frontend → Vercel
- Backend → Render (web service) + keep-warm cron ping to `/health`
- LLM engine → Render (Docker) + keep-warm, or run locally for the demo video
- n8n → Render/Railway (Docker), or local
- Database/Auth/vectors → Supabase (hosted free)
