-- The team + owner dashboards (docs/DASHBOARD_PLAN.md).
-- Staff can write in a patient's chat and take it over from the assistant (G1), staff report
-- assistant mistakes to the owner (G4), patients change their own email / phone with a code (G10).

-- ---------- staff write in a patient's chat (G1) ----------
-- 'staff' messages are written by a team member (author_id says who). A staff message with
-- tool_name 'joined' / 'left' and no text marks the moment someone took over or handed back.
alter type public.message_role add value if not exists 'staff';

alter table public.messages
  add column author_id uuid references public.profiles (id) on delete set null;

-- While taken_over_by is set the assistant stays quiet in that chat; the team member answers.
alter table public.conversations
  add column taken_over_by uuid references public.profiles (id) on delete set null,
  add column taken_over_at timestamptz;

-- Same view as before, plus author_id (new columns can only be added at the end).
create or replace view public.v_messages as
select
  m.id,
  m.conversation_id,
  m.role,
  case when public.current_user_role() = 'viewer' then public.mask_text(m.content) else m.content end as content,
  m.tool_name,
  case when public.current_user_role() = 'viewer' then null else m.tool_payload end as tool_payload,
  m.created_at,
  m.author_id
from public.messages m
where public.can_view_all();

-- ---------- assistant mistakes reported by the team (G4) ----------
-- Staff flag a wrong answer / wrong action; the owner sees them in the control room's
-- problem queue and resolves them (usually by fixing the knowledge base or a setting).
create table public.assistant_reports (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      bigint references public.messages (id) on delete set null,
  kind            text not null default 'wrong_answer'
                  check (kind in ('wrong_answer', 'wrong_action', 'tone', 'missed_handover', 'other')),
  note            text not null check (char_length(btrim(note)) between 1 and 1000),
  status          text not null default 'open' check (status in ('open', 'resolved')),
  reported_by     uuid references public.profiles (id) on delete set null,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  owner_note      text check (owner_note is null or char_length(owner_note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index assistant_reports_status_idx on public.assistant_reports (status, created_at desc);
create trigger assistant_reports_set_updated_at before update on public.assistant_reports
  for each row execute function public.set_updated_at();

-- ---------- a patient changing their own email or phone (G10) ----------
-- One pending change per field. The 6-digit code is stored only as a fingerprint (HMAC);
-- 5 wrong tries or 15 minutes and the change has to be started again.
create table public.contact_changes (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  field      text not null check (field in ('email', 'phone')),
  new_value  text not null,
  code_hmac  text not null,
  attempts   integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (patient_id, field)
);

-- the confirmation email for that code
alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications add constraint notifications_template_check check (template in (
  'booking_confirmed', 'login_code', 'booking_cancelled', 'welcome',
  'staff_alert', 'appointment_reminder', 'waitlist_slot_open', 'contact_change_code'));

-- ---------- security ----------
-- Both tables are used only by the backend (server key), after its own role checks:
-- RLS on with no policies = nobody else can read or write them.
alter table public.assistant_reports enable row level security;
alter table public.contact_changes   enable row level security;
