# Infra

Supporting services for the clinic assistant.

```
infra/
├── llm-engine/   LLM gateway (freellmapi): local compose + Hugging Face Space deploy
└── n8n/          Optional workflow automation
```

## LLM engine

An OpenAI-compatible gateway ([freellmapi](https://github.com/tashfeenahmed/freellmapi), pinned to `v0.16.7`) that routes each request across many free LLM providers, fails over on rate limits/errors, and tracks per-key quotas. The backend reaches it only through `backend/src/llm/LlmClient.js`.

### Run locally

```bash
cd infra/llm-engine
cp .env.example .env                                         # set ENCRYPTION_KEY
cp freellmapi.config.example.json freellmapi.config.json     # add provider keys
docker compose up -d
```

- Dashboard: http://localhost:3001 (create the admin account on first visit when `admin` is omitted from the config)
- API: `http://localhost:3001/v1` — authenticate with the **unified API key** shown on the dashboard's Keys page.

`freellmapi.config.json` and `.env` hold secrets and are gitignored. The config is applied on every boot (idempotent), so editing keys there and restarting is enough.

### Provider IDs used

`google` (Gemini) · `groq` · `cerebras` · `openrouter` · `cohere` · `nvidia` — more are listed in the upstream docs.

### Deploy (free): Hugging Face Space

`hf-space/` contains a Docker Space that runs the same pinned image. The Space disk is ephemeral, so state is kept by:

| Mechanism | Purpose |
|---|---|
| `FREEAPI_CONFIG_JSON` (secret) | admin account + provider keys, re-applied on every boot |
| `FREEAPI_DB_BACKUP_TARGET` + `FREEAPI_DB_BACKUP_TOKEN` | encrypted SQLite backup in a **private HF dataset**, auto-restored at startup — keeps the unified API key stable across restarts |
| `ENCRYPTION_KEY` (secret) | must stay the same forever, or stored keys and backups become unreadable |

Space settings → **Secrets**: `ENCRYPTION_KEY`, `FREEAPI_CONFIG_JSON`, `FREEAPI_DB_BACKUP_TOKEN`.
Space settings → **Variables**: `FREEAPI_DB_BACKUP_TARGET=https://huggingface.co/datasets/<user>/<dataset>/resolve/main/freellmapi.db.backup`, `VALIDATE_TOOL_ARGUMENTS=1`, `RESPONSE_CACHE=true`.

## n8n (optional)

```bash
cd infra/n8n && docker compose up -d   # http://localhost:5678
```

## Deployment overview (free)

- Frontend → Vercel
- Backend → Render (web service) + keep-warm ping to `/health`
- LLM engine → Hugging Face Space (Docker) + encrypted backup in a private HF dataset
- Database / Auth / vectors → Supabase
