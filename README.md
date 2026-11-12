# BrightSmile — AI Clinic Assistant

An AI front-desk assistant for a dental clinic, plus the clinic's website and dashboards. Patients chat in
**English or Arabic** to ask questions, **book, move or cancel appointments**, and sign up or sign in, all
inside the chat. The team gets dashboards for the day's schedule, patients, chat handovers and the
assistant's knowledge.

**Live demo:** https://brightsmile-sooty.vercel.app. The sign-in page offers a demo patient and a
read-only team view, so you can try both sides without an account.

---

## What the assistant does

- **Answers from the clinic's own information.** Services, prices, doctors and policies come from the
  database and an uploaded knowledge base (RAG over pgvector), not from the model's memory. Questions it
  can't answer are logged as knowledge gaps for the team.
- **Books for real.** It checks free times, shows them as tappable cards, and books, reschedules or
  cancels. Every change is proposed first and only happens after the patient confirms, and the assistant
  is never allowed to say something is done unless the database says so.
- **Remembers within a chat.** A per-chat notebook keeps what the patient already said (name, phone,
  chosen service and time), so nobody is asked twice. When details are needed, a form opens in the chat
  already filled in.
- **Remembers across chats, with consent.** Signed-in patients get long-term notes and can ask the
  assistant to forget them.
- **Keeps personal data away from the model.** Phone numbers, emails and birth dates are swapped for
  placeholders before anything reaches the AI.
- **Checks itself.** A second reviewer agent reads each reply before it is sent and asks for a rewrite
  if it breaks the rules.
- **Stays in its lane.** No medical advice; anything it shouldn't handle goes to a human, and the team
  can take over a chat live from the dashboard.
- **Replies in the patient's language**, including Egyptian Arabic, with right-to-left layout.

## The website and dashboards

- **Public site:** home page with an interactive 3D tooth, services, service details, about, privacy,
  a booking wizard and the assistant page. Fully bilingual (EN/AR, RTL).
- **Patient account:** upcoming appointments (cancel or move them), past chats and profile settings.
- **Team dashboard:** today's schedule, appointments, patients, chat inbox and handovers, time off.
- **Owner pages:** services and prices, doctors, team accounts, knowledge base, the assistant's reports
  and an activity log.

## How it is built

| Layer | Tech |
|---|---|
| Website | Next.js 16 (App Router), React 19, Tailwind CSS 4, English and Arabic |
| API | Node.js, Express 5, Zod validation |
| Assistant | A hand-written tool-calling loop (no LangChain) with 25 tools, guardrails, a reviewer agent and streaming replies (SSE) |
| AI models | One client over a private model gateway that fails over between several free providers |
| Database | Supabase: Postgres, pgvector, row-level security; booking rules enforced inside the database |
| Background jobs | Reminders, waitlist offers, data retention and knowledge extraction, run by the API's own job runner |
| Hosting | Website on Vercel, API on Render (Docker), both deploy on every push to `main` |

**Tests:** Vitest unit and integration tests for the API, database tests in `supabase/tests`, and an
agent eval suite (`npm run eval:agent`) that runs real conversations and checks language, safety, care
and memory.

## Repository layout

```
.
├── frontend/         Next.js website, patient account and team dashboards
├── backend/          Express API, the assistant (src/agent), RAG, jobs, tests and evals
├── supabase/         Database migrations, seed data, rollback scripts and database tests
├── infra/            Docker setup for Render and the AI model gateway
├── .archify/         Interactive system diagrams (open the HTML files in a browser)
└── frontend-drafts/  Early design trials for the home page
```

## Running it locally

You need Node.js 20+ and a Supabase project.

```bash
# API: http://localhost:4000
cd backend
npm install
cp .env.example .env    # fill in the Supabase and AI settings
npm run dev
```

```bash
# Website: http://localhost:3000
cd frontend
npm install
cp .env.example .env.local    # point it at the API
npm run dev
```

```bash
# Tests
cd backend
npm test
```

See [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md) for more.

## License

MIT
