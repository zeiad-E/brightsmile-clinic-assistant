# CareDesk Backend

Node.js + Express API. Hosts the agent loop, RAG, the LLM client, and booking/patient services.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # fill in values
npm run dev
```

Server runs on `http://localhost:4000`. Health check: `GET /health`.

## Structure

```
src/
├── index.js          Express entry
├── config/           Env config
├── llm/LlmClient.js  Wrapper over the freellmapi engine (+ fallback)
├── agent/            Hand-rolled tool-calling loop, system prompt, tools/
├── rag/              Embeddings + pgvector retrieval + ingest
├── services/         Booking, patients, escalations, automation
├── db/               Supabase client
├── routes/           API routes (chat, ...)
├── cache/            FAQ cache
└── utils/            Logger
```

## Key endpoint

`POST /api/chat` — `{ messages, context }` → agent reply.
