-- The assistant's flight recorder: one row per turn, with everything needed to debug it later.
-- What the AI was given (system prompt, recent messages), every model call (which model, how
-- long, why it stopped, what it wrote), every tool, every code check and rewrite, every review
-- (the reviewer's input, raw answer and verdict), and what reached the patient.
--
-- It holds masked chat text and the system prompt, which names a signed-in patient and their
-- notes. So, unlike agent_runs, it is deleted with its conversation (the 90-day clean-up and
-- "forget me"). Like every table since the auth rebuild (20261104000200), only the backend's
-- service role can reach it: row level security is on with no policies, and the public keys
-- have no rights. It is read with `npm run trace` in backend/.

create table public.agent_traces (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  turn            integer not null check (turn >= 1),
  outcome         public.run_outcome not null,
  latency_ms      integer check (latency_ms >= 0),
  trace           jsonb not null,
  created_at      timestamptz not null default now()
);

create index agent_traces_conversation_idx on public.agent_traces (conversation_id, created_at);
create index agent_traces_created_idx on public.agent_traces (created_at desc);

alter table public.agent_traces enable row level security;

revoke all on public.agent_traces from anon, authenticated, public;
grant select, insert, update, delete on public.agent_traces to service_role;
