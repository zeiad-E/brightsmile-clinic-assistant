-- Bookings: appointments (with database-enforced no-overlap rules), escalations, notifications.

create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete restrict,
  staff_id        uuid not null references public.staff (id) on delete restrict,
  service_id      uuid not null references public.services (id) on delete restrict,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,  -- set by trigger: starts_at + service duration
  status          public.appointment_status not null default 'booked',
  source          public.booking_source not null,
  notes           text,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_by      uuid references public.profiles (id) on delete set null,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint appointments_valid_range check (ends_at > starts_at),
  -- The real race-condition guard: two active bookings can never overlap for the
  -- same doctor or the same patient, no matter how concurrently they arrive.
  constraint appointments_no_staff_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked'),
  constraint appointments_no_patient_overlap exclude using gist (
    patient_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked')
);

create index appointments_staff_starts_idx on public.appointments (staff_id, starts_at);
create index appointments_patient_starts_idx on public.appointments (patient_id, starts_at);
create index appointments_status_starts_idx on public.appointments (status, starts_at);

create function public.set_appointment_end()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_duration integer;
begin
  select s.duration_minutes into v_duration from public.services s where s.id = new.service_id;
  if v_duration is null then
    raise exception 'unknown service %', new.service_id using errcode = 'foreign_key_violation';
  end if;
  new.ends_at := new.starts_at + make_interval(mins => v_duration);
  return new;
end;
$$;

create trigger appointments_set_end
  before insert or update of starts_at, service_id on public.appointments
  for each row execute function public.set_appointment_end();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- Handoffs to humans (clinical questions, urgent cases, out-of-scope requests).
create table public.escalations (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid,  -- FK added with the conversations table
  patient_id      uuid references public.patients (id) on delete set null,
  reason          text not null,
  urgency         public.urgency not null default 'normal',
  status          public.escalation_status not null default 'open',
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index escalations_status_created_idx on public.escalations (status, created_at desc);

create trigger escalations_set_updated_at
  before update on public.escalations
  for each row execute function public.set_updated_at();

-- Every email the system sends (and its delivery status).
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid references public.patients (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  channel        text not null default 'email' check (channel in ('email')),
  template       text not null check (template in ('booking_confirmed', 'login_code', 'booking_cancelled', 'welcome')),
  to_address     text not null,
  status         public.notification_status not null default 'queued',
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index notifications_patient_idx on public.notifications (patient_id, created_at desc);
