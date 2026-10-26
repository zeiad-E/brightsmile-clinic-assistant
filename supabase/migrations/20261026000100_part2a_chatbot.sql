-- Part 2a: the patient chatbot.
-- Conversation state and memory, agent memory notes, owner monitoring, intake questions,
-- knowledge gaps, waitlist, reminders, background jobs, chat privacy settings.

-- ---------- conversations: state, status, memory, owner review ----------
alter table public.conversations
  add column status          text not null default 'active'
                             check (status in ('active', 'handed_off', 'needs_attention', 'closed')),
  add column title           text,
  -- pending action awaiting the patient's "yes", placeholder map, counters, short refs
  add column state           jsonb not null default '{}',
  add column turn_count      integer not null default 0 check (turn_count >= 0),
  add column off_topic_count integer not null default 0 check (off_topic_count >= 0),
  add column blocked_until   timestamptz,
  add column summary         text,
  add column summary_embedding extensions.vector(768),
  add column summarized_at   timestamptz,
  add column reviewed_at     timestamptz,
  add column reviewed_by     uuid references public.profiles (id) on delete set null,
  add column review_note     text;

create index conversations_status_idx on public.conversations (status, last_message_at desc);
create index conversations_patient_idx on public.conversations (patient_id, last_message_at desc);

-- The owner reviews conversations (marks them reviewed, adds a correction note).
create policy conversations_review_owner on public.conversations for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- ---------- agent runs: cost and reliability tracing ----------
alter table public.agent_runs
  add column tokens_in  integer check (tokens_in >= 0),
  add column tokens_out integer check (tokens_out >= 0),
  add column retries    integer not null default 0 check (retries >= 0);

-- ---------- clinic settings: pause switch and chat retention ----------
alter table public.clinic_settings
  add column assistant_enabled   boolean not null default true,
  add column chat_retention_days integer not null default 90 check (chat_retention_days between 7 and 3650);

-- ---------- patients: answers to the owner's intake questions ----------
alter table public.patients add column intake jsonb not null default '{}';

-- ---------- appointments: reminder bookkeeping ----------
alter table public.appointments add column reminder_sent_at timestamptz;

-- ---------- notifications: new email kinds ----------
alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications add constraint notifications_template_check check (template in (
  'booking_confirmed', 'login_code', 'booking_cancelled', 'welcome',
  'staff_alert', 'appointment_reminder', 'waitlist_slot_open'));

-- ---------- agent memory notes (agent + owner only) ----------
create table public.patient_memories (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  kind            text not null check (kind in ('preference', 'communication_style', 'logistics')),
  content         text not null check (char_length(btrim(content)) between 1 and 200),
  source          text not null default 'agent' check (source in ('agent', 'owner')),
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index patient_memories_patient_idx on public.patient_memories (patient_id, updated_at desc);
create trigger patient_memories_set_updated_at before update on public.patient_memories
  for each row execute function public.set_updated_at();

-- ---------- intake questions the owner configures ----------
create table public.intake_fields (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  label_en   text not null,
  label_ar   text not null,
  kind       text not null default 'text' check (kind in ('text', 'choice')),
  options    jsonb not null default '[]',   -- for 'choice': [{"value":"…","label_en":"…","label_ar":"…"}]
  required   boolean not null default false,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger intake_fields_set_updated_at before update on public.intake_fields
  for each row execute function public.set_updated_at();

insert into public.intake_fields (key, label_en, label_ar, kind, options, required, sort_order) values
  ('insurance', 'Insurance company', 'شركة التأمين', 'choice',
   '[{"value":"nilecare","label_en":"NileCare Health","label_ar":"نايل كير"},
     {"value":"delta_shield","label_en":"Delta Shield","label_ar":"دلتا شيلد"},
     {"value":"horus","label_en":"Horus Medical Network","label_ar":"شبكة حورس الطبية"},
     {"value":"none","label_en":"No insurance (self-pay)","label_ar":"بدون تأمين"}]', false, 1),
  ('city', 'City / area', 'المدينة / المنطقة', 'text', '[]', false, 2),
  ('referral', 'How did you hear about us?', 'كيف عرفت عنا؟', 'text', '[]', false, 3)
on conflict (key) do nothing;

-- ---------- questions the assistant couldn't answer ----------
create table public.knowledge_gaps (
  id                   uuid primary key default gen_random_uuid(),
  question             text not null,
  normalized           text not null,
  language             public.lang not null default 'en',
  count                integer not null default 1 check (count >= 1),
  status               text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  last_conversation_id uuid references public.conversations (id) on delete set null,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  unique (normalized, language)
);

-- ---------- waitlist ----------
create table public.waitlist (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  service_id      uuid not null references public.services (id) on delete cascade,
  staff_id        uuid references public.staff (id) on delete cascade,  -- null = any doctor
  date_from       date not null,
  date_to         date not null,
  status          text not null default 'waiting' check (status in ('waiting', 'notified', 'booked', 'cancelled', 'expired')),
  notified_at     timestamptz,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint waitlist_valid_range check (date_to >= date_from)
);
create index waitlist_lookup_idx on public.waitlist (service_id, status, date_from);
create trigger waitlist_set_updated_at before update on public.waitlist
  for each row execute function public.set_updated_at();

-- ---------- background jobs (survive restarts) ----------
create table public.jobs (
  id           bigint generated always as identity primary key,
  type         text not null,
  payload      jsonb not null default '{}',
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at       timestamptz not null default now(),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index jobs_due_idx on public.jobs (status, run_at);
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- Hands out due jobs to one worker at a time (SKIP LOCKED: two workers never get the same job).
create function public.claim_jobs(p_limit integer default 5)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running', locked_at = now(), attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where status = 'queued' and run_at <= now()
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- Past-conversation recall: one patient's summaries, most similar first.
create function public.match_conversation_summaries(
  p_patient_id    uuid,
  query_embedding extensions.vector(768),
  match_count     integer default 2,
  min_similarity  double precision default 0.3
)
returns table (conversation_id uuid, summary text, last_message_at timestamptz, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select c.id, c.summary, c.last_message_at, 1 - (c.summary_embedding <=> query_embedding) as similarity
  from public.conversations c
  where c.patient_id = p_patient_id
    and c.summary_embedding is not null
    and 1 - (c.summary_embedding <=> query_embedding) >= min_similarity
  order by c.summary_embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.claim_jobs(integer) from public, anon, authenticated;
revoke execute on function public.match_conversation_summaries(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer) to service_role;
grant execute on function public.match_conversation_summaries(uuid, extensions.vector, integer, double precision) to service_role;

-- ---------- security ----------
alter table public.patient_memories enable row level security;
alter table public.intake_fields    enable row level security;
alter table public.knowledge_gaps   enable row level security;
alter table public.waitlist         enable row level security;
alter table public.jobs             enable row level security;  -- no policies: backend only

-- Memory notes: the agent writes them with the server key; only the owner reads and corrects them.
create policy patient_memories_owner on public.patient_memories for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Intake questions: everyone reads the active ones; the owner manages them.
create policy intake_fields_select on public.intake_fields for select to anon, authenticated
  using (is_active or (select public.can_view_all()));
create policy intake_fields_owner on public.intake_fields for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Knowledge gaps: owner and viewer read, owner updates.
create policy knowledge_gaps_select on public.knowledge_gaps for select to authenticated
  using ((select public.current_user_role()) in ('owner', 'viewer'));
create policy knowledge_gaps_owner on public.knowledge_gaps for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Waitlist: patients see their own; staff/owner/viewer see all; staff/owner update.
create policy waitlist_select on public.waitlist for select to authenticated
  using (
    (select public.can_view_all())
    or exists (select 1 from public.patients p where p.id = waitlist.patient_id and p.profile_id = (select auth.uid()))
  );
create policy waitlist_staff_update on public.waitlist for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

revoke all on public.jobs from anon, authenticated;

-- Owner edits of memory notes and intake questions go to the audit log.
create trigger audit_patient_memories after insert or update or delete on public.patient_memories
  for each row execute function public.audit_row_change();
create trigger audit_intake_fields after insert or update or delete on public.intake_fields
  for each row execute function public.audit_row_change();
