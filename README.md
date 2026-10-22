# CareDesk AI — Clinic Front-Desk & Booking Agent

An AI front-desk assistant for clinics. Patients chat (in **English or Arabic**) to get answers from the clinic's own information, **book appointments 24/7**, and create an account — all by talking to the bot. Staff and owners get a **role-based dashboard** to manage bookings, availability, and the knowledge base.

> Built with an AI agent, retrieval-augmented generation (RAG), and workflow automation on a modern full-stack architecture.

---

## ✨ Key features

- **Bilingual chatbot (EN/AR)** with RTL support — detects the patient's language and replies in it.
- **RAG knowledge assistant** — answers only from the clinic's real data, with citations (no hallucinated prices/hours).
- **Agentic booking** — a hand-rolled tool-calling agent that checks availability and books appointments itself.
- **Conversational onboarding** — patients create an account and log in (passwordless) by chatting.
- **Safe by design** — refuses medical advice and escalates to staff; hard limits prevent loops/hallucination.
- **Role-based dashboard** — Patient / Staff / Owner views.
- **Automation (optional)** — booking confirmations, logging, and staff alerts via n8n.

## 🧱 Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js, React, Tailwind, i18n (EN/AR) |
| Backend | Node.js + JavaScript, Express |
| Agent | Custom tool-calling loop (no LangChain) |
| LLM | `LlmClient` wrapper → self-hosted **freellmapi** engine (free providers, failover) |
| Database | Supabase (Postgres + pgvector + Auth) |
| Automation | n8n (self-hosted) |

## 📁 Repository layout

```
.
├── frontend/     Next.js app (public site, chat, dashboards)
├── backend/      Express API, agent loop, RAG, LLM client
└── infra/        Docker compose for the LLM engine + n8n, deployment notes
```

## 🚀 Getting started

See [`backend/README`](./backend) and [`frontend/README`](./frontend).

## 🧪 Demo accounts

Demo logins (patient / staff / owner) will be listed here once deployed.

## 📄 License

MIT
