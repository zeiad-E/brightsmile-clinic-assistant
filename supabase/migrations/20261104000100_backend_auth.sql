-- Sign-in moves from Supabase Auth into the backend, step A: this migration only ADDS.
-- The current backend (user tokens + RLS) keeps working; views and functions also accept the
-- server key, which the new backend uses for everything. A later migration removes the old parts.

-- ---------- profiles: no longer tied to auth.users ----------
-- New team and patient profiles have no Supabase login, so the id gets its own default.
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

-- That foreign key also removed the profile when a login was deleted, and the current backend
-- relies on it (spare login after a race, test clean-up). Same effect until the old parts go.
create function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

alter table public.profiles
  add column password_hash         text,
  add column password_changed_at   timestamptz,
  add column must_change_password  boolean not null default false,
  add column failed_login_attempts integer not null default 0 check (failed_login_attempts >= 0),
  add column locked_until          timestamptz,
  add column disabled_at           timestamptz,
  add column last_sign_in_at       timestamptz;

-- Passwords are for the team, so a team email can sign in to exactly one account.
create unique index profiles_team_email_key on public.profiles (email) where role <> 'patient';

-- Sign-in secrets stay server-side: staff can read every profile row, so without this any of
-- them could read all the password hashes with the public key. Same rule as public.patients.
revoke all on public.profiles from anon;
revoke select on public.profiles from authenticated;
grant select (id, role, full_name, email, phone, preferred_language, created_at, updated_at)
  on public.profiles to authenticated;

-- ---------- patients: the personal code, readable by the backend ----------
-- code_hmac still finds the patient; the ciphertext is what gets shown back to them. Earlier
-- column grants list what logged-in users may read, so these new columns stay hidden from them.
alter table public.patients
  add column code_ciphertext text,
  add column code_key_id     text,   -- which key encrypted it, so keys can be rotated
  add column code_issued_at  timestamptz,
  add constraint patients_code_ciphertext_has_key check ((code_ciphertext is null) = (code_key_id is null));

-- ---------- sessions ----------
-- One row per signed-in device. Only fingerprints of the refresh token are stored. previous_hash
-- tells two tabs refreshing at once apart from a stolen old token; redeem_by is the deadline of
-- a one-time ticket (the chat can't set a cookie, so it hands one to the browser instead).
create table public.auth_sessions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  refresh_hash  text not null,
  previous_hash text,
  rotated_at    timestamptz,
  method        text not null check (method in ('password', 'email_code', 'phone', 'personal_code', 'sign_up', 'booking', 'demo')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeem_by     timestamptz,
  revoked_at    timestamptz,
  revoke_reason text,
  user_agent    text,
  ip            text
);
create index auth_sessions_profile_active_idx on public.auth_sessions (profile_id) where revoked_at is null;

-- ---------- emailed 6-digit codes ----------
-- One live code per purpose and email; the code itself is stored only as a fingerprint (HMAC).
-- A sign-up waits in payload until its code is confirmed. send_count and window_started_at
-- count the sends in the current hour.
create table public.login_codes (
  id                uuid primary key default gen_random_uuid(),
  purpose           text not null check (purpose in ('sign_in', 'sign_up')),
  email             extensions.citext not null,
  profile_id        uuid references public.profiles (id) on delete cascade,
  code_hmac         text not null,
  payload           jsonb,
  attempts          integer not null default 0 check (attempts >= 0),
  send_count        integer not null default 1 check (send_count >= 0),
  window_started_at timestamptz not null default now(),
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  unique (purpose, email)
);

-- Backend only: RLS on with no policies, and no rights for the public key at all.
alter table public.auth_sessions enable row level security;
alter table public.login_codes   enable row level security;
revoke all on public.auth_sessions, public.login_codes from anon, authenticated;
grant select, insert, update, delete on public.auth_sessions, public.login_codes to service_role;

-- ---------- notifications: the sign-in email ----------
alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications add constraint notifications_template_check check (template in (
  'booking_confirmed', 'login_code', 'booking_cancelled', 'welcome',
  'staff_alert', 'appointment_reminder', 'waitlist_slot_open', 'contact_change_code', 'email_code'));

-- ---------- views: the server key gets rows too ----------
-- Same views as before with a wider filter. The masking needs no change: the server key has
-- no profile, so current_user_role() is null and every case takes its unmasked branch.
create or replace view public.v_patients as
select
  p.id,
  p.profile_id,
  case when public.current_user_role() = 'viewer' then public.mask_person_name(p.full_name) else p.full_name end as full_name,
  case when public.current_user_role() = 'viewer' then null else p.date_of_birth end as date_of_birth,
  case when public.current_user_role() = 'viewer' then public.mask_email(p.email::text) else p.email::text end as email,
  case when public.current_user_role() = 'viewer' then public.mask_phone(p.phone) else p.phone end as phone,
  p.preferred_language,
  case when public.current_user_role() = 'viewer' then public.mask_text(p.notes) else p.notes end as notes,
  p.created_at
from public.patients p
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

-- Plus the sign-in state, for the team screen (new columns can only be added at the end).
create or replace view public.v_profiles as
select
  pr.id,
  pr.role,
  case when public.current_user_role() = 'viewer' then public.mask_person_name(pr.full_name) else pr.full_name end as full_name,
  case when public.current_user_role() = 'viewer' then public.mask_email(pr.email::text) else pr.email::text end as email,
  case when public.current_user_role() = 'viewer' then public.mask_phone(pr.phone) else pr.phone end as phone,
  pr.preferred_language,
  pr.created_at,
  pr.disabled_at,
  pr.must_change_password,
  pr.last_sign_in_at
from public.profiles pr
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

create or replace view public.v_appointments as
select
  a.id,
  a.starts_at,
  a.ends_at,
  a.status,
  a.source,
  a.staff_id,
  st.full_name_en as doctor_name_en,
  st.full_name_ar as doctor_name_ar,
  a.service_id,
  sv.name_en as service_name_en,
  sv.name_ar as service_name_ar,
  a.patient_id,
  case when public.current_user_role() = 'viewer' then public.mask_person_name(p.full_name) else p.full_name end as patient_name,
  case when public.current_user_role() = 'viewer' then public.mask_text(a.notes) else a.notes end as notes,
  a.cancelled_at,
  a.created_at
from public.appointments a
join public.staff st on st.id = a.staff_id
join public.services sv on sv.id = a.service_id
join public.patients p on p.id = a.patient_id
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

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
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

create or replace view public.v_notifications as
select
  n.id,
  n.patient_id,
  n.appointment_id,
  n.channel,
  n.template,
  case when public.current_user_role() = 'viewer' then public.mask_email(n.to_address) else n.to_address end as to_address,
  n.status,
  n.error,
  n.sent_at,
  n.created_at
from public.notifications n
where public.current_user_role() in ('owner', 'viewer') or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

create or replace view public.v_audit_log as
select
  l.id,
  l.actor_id,
  l.via,
  l.action,
  l.entity,
  l.entity_id,
  case when public.current_user_role() = 'viewer' then l.before - 'notes' - 'cancel_reason' else l.before end as before,
  case when public.current_user_role() = 'viewer' then l.after - 'notes' - 'cancel_reason' else l.after end as after,
  l.created_at
from public.audit_log l
where public.current_user_role() in ('owner', 'viewer') or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

create or replace view public.v_stats_today as
with settings as (
  select timezone from public.clinic_settings where id = 1
),
bounds as (
  select
    ((now() at time zone s.timezone)::date)::timestamp at time zone s.timezone as day_start,
    (((now() at time zone s.timezone)::date) + 1)::timestamp at time zone s.timezone as day_end,
    (now() at time zone s.timezone)::date as day
  from settings s
)
select
  b.day,
  (select count(*) from public.patients p where p.created_at >= b.day_start and p.created_at < b.day_end) as new_patients,
  (select count(*) from public.appointments a where a.created_at >= b.day_start and a.created_at < b.day_end) as bookings_made,
  (select count(*) from public.appointments a where a.status = 'booked' and a.starts_at >= b.day_start and a.starts_at < b.day_end) as appointments_scheduled,
  (select count(*) from public.appointments a where a.cancelled_at >= b.day_start and a.cancelled_at < b.day_end) as cancellations,
  (select count(*) from public.escalations e where e.status = 'open') as open_escalations,
  (select count(*) from public.agent_runs r where r.created_at >= b.day_start and r.created_at < b.day_end) as ai_turns,
  (select count(*) from public.agent_runs r where r.outcome = 'booked' and r.created_at >= b.day_start and r.created_at < b.day_end) as ai_bookings
from bounds b
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';

create or replace view public.v_stats_upcoming_by_doctor as
select
  st.id as staff_id,
  st.full_name_en,
  st.full_name_ar,
  count(a.id) filter (where a.status = 'booked' and a.starts_at >= now() and a.starts_at < now() + interval '7 days') as booked_next_7_days
from public.staff st
left join public.appointments a on a.staff_id = st.id
where public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
group by st.id, st.full_name_en, st.full_name_ar;

create or replace view public.v_ai_outcomes_7d as
select
  r.assistant,
  r.outcome,
  count(*) as runs,
  round(avg(r.latency_ms)) as avg_latency_ms
from public.agent_runs r
where r.created_at >= now() - interval '7 days'
  and (public.can_view_all() or coalesce(auth.jwt() ->> 'role', '') = 'service_role')
group by r.assistant, r.outcome;

-- These helpers run inside the views and functions above when the server key calls them.
grant execute on function public.current_user_role() to service_role;
grant execute on function public.can_view_all()      to service_role;
grant execute on function public.is_owner()          to service_role;

-- ---------- masked twins: what the viewer sees, whoever asks ----------
-- Same columns as the plain views, so the backend only swaps the name. The masks are always
-- on and there's no role check; the backend picks the view, so only the server key may read them.
create view public.v_patients_masked as
select
  p.id,
  p.profile_id,
  public.mask_person_name(p.full_name) as full_name,
  null::date as date_of_birth,
  public.mask_email(p.email::text) as email,
  public.mask_phone(p.phone) as phone,
  p.preferred_language,
  public.mask_text(p.notes) as notes,
  p.created_at
from public.patients p;

create view public.v_profiles_masked as
select
  pr.id,
  pr.role,
  public.mask_person_name(pr.full_name) as full_name,
  public.mask_email(pr.email::text) as email,
  public.mask_phone(pr.phone) as phone,
  pr.preferred_language,
  pr.created_at,
  pr.disabled_at,
  pr.must_change_password,
  pr.last_sign_in_at
from public.profiles pr;

create view public.v_appointments_masked as
select
  a.id,
  a.starts_at,
  a.ends_at,
  a.status,
  a.source,
  a.staff_id,
  st.full_name_en as doctor_name_en,
  st.full_name_ar as doctor_name_ar,
  a.service_id,
  sv.name_en as service_name_en,
  sv.name_ar as service_name_ar,
  a.patient_id,
  public.mask_person_name(p.full_name) as patient_name,
  public.mask_text(a.notes) as notes,
  a.cancelled_at,
  a.created_at
from public.appointments a
join public.staff st on st.id = a.staff_id
join public.services sv on sv.id = a.service_id
join public.patients p on p.id = a.patient_id;

create view public.v_messages_masked as
select
  m.id,
  m.conversation_id,
  m.role,
  public.mask_text(m.content) as content,
  m.tool_name,
  null::jsonb as tool_payload,
  m.created_at,
  m.author_id
from public.messages m;

create view public.v_notifications_masked as
select
  n.id,
  n.patient_id,
  n.appointment_id,
  n.channel,
  n.template,
  public.mask_email(n.to_address) as to_address,
  n.status,
  n.error,
  n.sent_at,
  n.created_at
from public.notifications n;

create view public.v_audit_log_masked as
select
  l.id,
  l.actor_id,
  l.via,
  l.action,
  l.entity,
  l.entity_id,
  l.before - 'notes' - 'cancel_reason' as before,
  l.after - 'notes' - 'cancel_reason' as after,
  l.created_at
from public.audit_log l;

-- New views are readable by everyone by default, and these skip RLS: lock them down first.
revoke all on public.v_patients_masked, public.v_profiles_masked, public.v_appointments_masked,
  public.v_messages_masked, public.v_notifications_masked, public.v_audit_log_masked
  from public, anon, authenticated;
grant select on public.v_patients_masked, public.v_profiles_masked, public.v_appointments_masked,
  public.v_messages_masked, public.v_notifications_masked, public.v_audit_log_masked
  to service_role;

-- ---------- cancel and reschedule ----------
-- The server key with no actor is the new backend: it has already checked who may do this, so
-- only the row lock, the status check and the overlap rules remain. Anyone else, including the
-- server key acting for a named actor, gets the same rules as before.
create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_trusted     boolean;
  v_role        public.user_role;
  v_appointment public.appointments;
  v_owner       uuid;
  v_window      integer;
begin
  v_actor := coalesce(
    (select auth.uid()),
    case when coalesce((select auth.jwt()) ->> 'role', '') = 'service_role' then p_actor end
  );
  v_trusted := v_actor is null and coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';

  if not v_trusted then
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    select role into v_role from public.profiles where id = v_actor;
    if v_role is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if v_role = 'viewer' then
      return jsonb_build_object('ok', false, 'error', 'read_only');
    end if;
  end if;

  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_role = 'patient' then
    select p.profile_id into v_owner from public.patients p where p.id = v_appointment.patient_id;
    if v_owner is distinct from v_actor then
      return jsonb_build_object('ok', false, 'error', 'not_found');  -- don't reveal other patients' bookings
    end if;
  end if;

  if v_appointment.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  if v_role = 'patient' then
    select cancellation_window_hours into v_window from public.clinic_settings where id = 1;
    if v_appointment.starts_at - now() < make_interval(hours => v_window) then
      return jsonb_build_object('ok', false, 'error', 'too_late', 'window_hours', v_window);
    end if;
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = p_appointment_id;

  return jsonb_build_object('ok', true, 'appointment_id', p_appointment_id);
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz,
  p_new_staff_id   uuid default null,
  p_actor          uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_trusted     boolean;
  v_role        public.user_role;
  v_appointment public.appointments;
  v_owner       uuid;
  v_window      integer;
  v_tz          text;
  v_staff       uuid;
  v_constraint  text;
begin
  v_actor := coalesce(
    (select auth.uid()),
    case when coalesce((select auth.jwt()) ->> 'role', '') = 'service_role' then p_actor end
  );
  v_trusted := v_actor is null and coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';

  if not v_trusted then
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    select role into v_role from public.profiles where id = v_actor;
    if v_role is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if v_role = 'viewer' then
      return jsonb_build_object('ok', false, 'error', 'read_only');
    end if;
  end if;

  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_role = 'patient' then
    select p.profile_id into v_owner from public.patients p where p.id = v_appointment.patient_id;
    if v_owner is distinct from v_actor then
      return jsonb_build_object('ok', false, 'error', 'not_found');  -- don't reveal other patients' bookings
    end if;
  end if;

  if v_appointment.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  if v_role = 'patient' then
    select cancellation_window_hours into v_window from public.clinic_settings where id = 1;
    if v_appointment.starts_at - now() < make_interval(hours => v_window) then
      return jsonb_build_object('ok', false, 'error', 'too_late', 'window_hours', v_window);
    end if;
  end if;

  v_staff := coalesce(p_new_staff_id, v_appointment.staff_id);

  -- The new time must be bookable (working hours, lead time, horizon, time off, doctor
  -- offers the service). Other bookings are ignored here: the constraint judges those.
  select timezone into v_tz from public.clinic_settings where id = 1;
  if not exists (
    select 1
    from public.get_available_slots(v_appointment.service_id, v_staff, (p_new_starts_at at time zone v_tz)::date, true) s
    where s.slot_start = p_new_starts_at
  ) then
    return jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  end if;

  begin
    update public.appointments
    set starts_at = p_new_starts_at, staff_id = v_staff   -- ends_at follows via trigger
    where id = p_appointment_id
    returning * into v_appointment;
  exception
    when exclusion_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object(
        'ok', false,
        'error', case when v_constraint = 'appointments_no_patient_overlap' then 'patient_has_overlap' else 'slot_taken' end);
  end;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment.id,
    'staff_id', v_appointment.staff_id,
    'starts_at', v_appointment.starts_at,
    'ends_at', v_appointment.ends_at);
end;
$$;

-- ---------- owner schedule edits: allowed for the server key ----------
-- Still runs as the caller; with the server key the audit log reads the x-actor-id header.
create or replace function public.set_working_hours(p_staff_id uuid, p_hours jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (public.is_owner() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'only the owner can change working hours' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_hours');
  end if;

  begin
    delete from public.working_hours where staff_id = p_staff_id;
    insert into public.working_hours (staff_id, weekday, start_time, end_time)
    select p_staff_id, h.weekday, h.start_time, h.end_time
    from jsonb_to_recordset(p_hours) as h(weekday smallint, start_time time, end_time time);
    get diagnostics v_count = row_count;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'error', 'overlapping_shifts');
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'error', 'invalid_hours');
  end;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

create or replace function public.set_staff_services(p_staff_id uuid, p_service_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (public.is_owner() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'only the owner can change who offers which service' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  begin
    delete from public.staff_services where staff_id = p_staff_id;
    insert into public.staff_services (staff_id, service_id)
    select distinct p_staff_id, s from unnest(coalesce(p_service_ids, '{}')) s;
    get diagnostics v_count = row_count;
  exception
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'error', 'unknown_service');
  end;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

grant execute on function public.set_working_hours(uuid, jsonb) to service_role;
grant execute on function public.set_staff_services(uuid, uuid[]) to service_role;

-- ---------- reminders: placeholder emails are going away ----------
-- With no placeholder domain to skip, every patient with an email gets a reminder.
create or replace function public.queue_due_reminders(p_skip_email_domain text default null, p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window integer;
  v_count  integer;
begin
  select cancellation_window_hours into v_window from public.clinic_settings where id = 1;

  with due as (
    select a.id, a.starts_at
    from public.appointments a
    join public.patients p on p.id = a.patient_id
    where a.status = 'booked'
      and a.reminder_sent_at is null
      and a.starts_at > now() + interval '2 hours'
      and a.starts_at <= now() + make_interval(hours => coalesce(v_window, 24) + 24)
      and a.created_at <= now() - interval '12 hours'
      and p.email is not null
      and (p_skip_email_domain is null or lower(p.email) not like '%@' || lower(p_skip_email_domain))
    order by a.starts_at
    limit p_limit
    for update of a skip locked
  ),
  claimed as (
    update public.appointments a
    set reminder_sent_at = now()
    from due
    where a.id = due.id
    returning a.id, a.starts_at
  )
  insert into public.jobs (type, payload)
  select 'send_reminder', jsonb_build_object('appointment_id', id, 'starts_at', starts_at)
  from claimed;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
