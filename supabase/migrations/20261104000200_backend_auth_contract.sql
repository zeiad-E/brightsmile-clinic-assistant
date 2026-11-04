-- Sign-in moves from Supabase Auth into the backend, step B: the old parts go.
-- The backend already does all sign-in and every permission check, using the server key. From
-- here the database only stores data and protects it from double bookings. Row Level Security
-- stays on with no policies, and the public keys get no rights at all: they can read nothing.
-- Take a backup first. supabase/rollback/20261104000200_backend_auth_contract_down.sql undoes this.

-- ---------- every patient has exactly one profile ----------
do $$
declare
  v_patient record;
  v_profile uuid;
begin
  for v_patient in select id, full_name, preferred_language from public.patients where profile_id is null loop
    insert into public.profiles (role, full_name, preferred_language)
    values ('patient', v_patient.full_name, v_patient.preferred_language)
    returning id into v_profile;
    update public.patients set profile_id = v_profile where id = v_patient.id;
  end loop;
end;
$$;

-- A patient signs in with what is on their patient record, so their profile holds no contact details.
update public.profiles set email = null, phone = null where role = 'patient';
alter table public.profiles
  add constraint profiles_patient_no_contact check (role <> 'patient' or (email is null and phone is null));

alter table public.patients drop constraint patients_profile_id_fkey;
alter table public.patients
  add constraint patients_profile_id_fkey foreign key (profile_id) references public.profiles (id) on delete restrict,
  alter column profile_id set not null;

-- A trigger, because book_appointment creates patients inside SQL too.
create function public.create_patient_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is null then
    insert into public.profiles (role, full_name, preferred_language)
    values ('patient', new.full_name, new.preferred_language)
    returning id into new.profile_id;
  end if;
  return new;
end;
$$;

create trigger patients_create_profile
  before insert on public.patients
  for each row execute function public.create_patient_profile();

-- The trigger runs before the unique checks, so a lost race must undo it: an exception block
-- rolls back the new profile with the failed insert, where `on conflict do nothing` would leave
-- it behind.
create or replace function public.book_appointment(
  p_service_id         uuid,
  p_staff_id           uuid,
  p_starts_at          timestamptz,
  p_full_name          text,
  p_date_of_birth      date,
  p_email              text default null,
  p_phone              text default null,
  p_preferred_language public.lang default 'en',
  p_source             public.booking_source default 'patient_assistant',
  p_idempotency_key    text default null,
  p_created_by         uuid default null,
  p_notes              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email       text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone       text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '');
  v_name        text := nullif(btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), '');
  v_tz          text;
  v_existing    public.appointments;
  v_by_email    public.patients;
  v_by_phone    public.patients;
  v_patient     public.patients;
  v_is_new      boolean := false;
  v_appointment public.appointments;
  v_constraint  text;
begin
  -- 0. Same request retried (double-click / network retry) → return the existing booking.
  if p_idempotency_key is not null then
    select * into v_existing from public.appointments where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'is_new_patient', false,
        'appointment_id', v_existing.id, 'patient_id', v_existing.patient_id,
        'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at);
    end if;
  end if;

  -- 1. Validate input.
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if v_email is null and v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'contact_required');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;
  if p_date_of_birth is null or p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'error', 'invalid_date_of_birth');
  end if;

  -- 2. The requested time must be one of the currently free slots.
  select timezone into v_tz from public.clinic_settings where id = 1;
  if not exists (
    select 1
    from public.get_available_slots(p_service_id, p_staff_id, (p_starts_at at time zone v_tz)::date) s
    where s.slot_start = p_starts_at
  ) then
    -- A valid slot that someone else booked → slot_taken; otherwise not a bookable time.
    if exists (
      select 1
      from public.get_available_slots(p_service_id, p_staff_id, (p_starts_at at time zone v_tz)::date, true) s
      where s.slot_start = p_starts_at
    ) then
      return jsonb_build_object('ok', false, 'error', 'slot_taken');
    end if;
    return jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  end if;

  -- 3. Find the patient by email/phone, or register them (race-safe).
  if v_email is not null then
    select * into v_by_email from public.patients where email = v_email;
  end if;
  if v_phone is not null then
    select * into v_by_phone from public.patients where phone = v_phone;
  end if;

  if v_by_email.id is not null and v_by_phone.id is not null and v_by_email.id <> v_by_phone.id then
    return jsonb_build_object('ok', false, 'error', 'contact_conflict');
  end if;

  if v_by_email.id is not null then
    v_patient := v_by_email;
  elsif v_by_phone.id is not null then
    v_patient := v_by_phone;
  end if;

  if v_patient.id is null then
    begin
      insert into public.patients (full_name, date_of_birth, email, phone, preferred_language)
      values (v_name, p_date_of_birth, v_email, v_phone, p_preferred_language)
      returning * into v_patient;
      v_is_new := true;
    exception
      when unique_violation then
        -- A concurrent booking registered this patient a moment ago: reuse that row.
        select * into v_patient
        from public.patients
        where (v_email is not null and email = v_email)
           or (v_phone is not null and phone = v_phone)
        limit 1;
    end;
  end if;

  if not v_is_new then
    -- Booking for an existing patient: the date of birth must match.
    if v_patient.date_of_birth <> p_date_of_birth then
      return jsonb_build_object('ok', false, 'error', 'identity_mismatch');
    end if;
    -- Fill in a contact detail the patient didn't have yet.
    if v_patient.email is null and v_email is not null then
      update public.patients set email = v_email where id = v_patient.id;
    end if;
    if v_patient.phone is null and v_phone is not null then
      update public.patients set phone = v_phone where id = v_patient.id;
    end if;
  end if;

  -- 4. Insert. The exclusion constraints are the final guard against concurrent bookings.
  begin
    insert into public.appointments (
      patient_id, staff_id, service_id, starts_at, ends_at,
      source, notes, created_by, idempotency_key)
    values (
      v_patient.id, p_staff_id, p_service_id, p_starts_at, p_starts_at,  -- ends_at set by trigger
      p_source, p_notes, p_created_by, p_idempotency_key)
    returning * into v_appointment;
  exception
    when exclusion_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object(
        'ok', false,
        'error', case when v_constraint = 'appointments_no_patient_overlap' then 'patient_has_overlap' else 'slot_taken' end,
        'patient_id', v_patient.id,
        'is_new_patient', v_is_new);
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'appointments_idempotency_key_key' then
        select * into v_existing from public.appointments where idempotency_key = p_idempotency_key;
        return jsonb_build_object(
          'ok', true, 'replayed', true, 'is_new_patient', false,
          'appointment_id', v_existing.id, 'patient_id', v_existing.patient_id,
          'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at);
      end if;
      raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'appointment_id', v_appointment.id,
    'patient_id', v_patient.id,
    'profile_id', v_patient.profile_id,
    'is_new_patient', v_is_new,
    'starts_at', v_appointment.starts_at,
    'ends_at', v_appointment.ends_at);
end;
$$;

-- ---------- views: no role checks ----------
-- Only the server key can read views now. It picks the masked twin for the viewer.
create or replace view public.v_patients as
select
  p.id,
  p.profile_id,
  p.full_name,
  p.date_of_birth,
  p.email::text as email,
  p.phone,
  p.preferred_language,
  p.notes,
  p.created_at
from public.patients p;

create or replace view public.v_profiles as
select
  pr.id,
  pr.role,
  pr.full_name,
  pr.email::text as email,
  pr.phone,
  pr.preferred_language,
  pr.created_at,
  pr.disabled_at,
  pr.must_change_password,
  pr.last_sign_in_at
from public.profiles pr;

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
  p.full_name as patient_name,
  a.notes,
  a.cancelled_at,
  a.created_at
from public.appointments a
join public.staff st on st.id = a.staff_id
join public.services sv on sv.id = a.service_id
join public.patients p on p.id = a.patient_id;

create or replace view public.v_messages as
select
  m.id,
  m.conversation_id,
  m.role,
  m.content,
  m.tool_name,
  m.tool_payload,
  m.created_at,
  m.author_id
from public.messages m;

create or replace view public.v_notifications as
select
  n.id,
  n.patient_id,
  n.appointment_id,
  n.channel,
  n.template,
  n.to_address,
  n.status,
  n.error,
  n.sent_at,
  n.created_at
from public.notifications n;

create or replace view public.v_audit_log as
select
  l.id,
  l.actor_id,
  l.via,
  l.action,
  l.entity,
  l.entity_id,
  l.before,
  l.after,
  l.created_at
from public.audit_log l;

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
from bounds b;

create or replace view public.v_stats_upcoming_by_doctor as
select
  st.id as staff_id,
  st.full_name_en,
  st.full_name_ar,
  count(a.id) filter (where a.status = 'booked' and a.starts_at >= now() and a.starts_at < now() + interval '7 days') as booked_next_7_days
from public.staff st
left join public.appointments a on a.staff_id = st.id
group by st.id, st.full_name_en, st.full_name_ar;

create or replace view public.v_ai_outcomes_7d as
select
  r.assistant,
  r.outcome,
  count(*) as runs,
  round(avg(r.latency_ms)) as avg_latency_ms
from public.agent_runs r
where r.created_at >= now() - interval '7 days'
group by r.assistant, r.outcome;


-- ---------- cancel and reschedule: only the data rules stay ----------
-- Who may do this, and until when, is checked in the backend. These keep the row lock, the status
-- check and the no-overlap rules. Nothing outside the server key can call them.
drop function public.cancel_appointment(uuid, text, uuid);
drop function public.reschedule_appointment(uuid, timestamptz, uuid, uuid);

create function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_appointment.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = p_appointment_id;

  return jsonb_build_object('ok', true, 'appointment_id', p_appointment_id);
end;
$$;

create function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz,
  p_new_staff_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_tz          text;
  v_staff       uuid;
  v_constraint  text;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_appointment.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
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


create or replace function public.set_working_hours(p_staff_id uuid, p_hours jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
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

-- ---------- audit log: the actor comes from the backend's headers ----------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_actor   uuid;
  v_via     text;
  v_old     jsonb;
  v_new     jsonb;
  v_column  text;
begin
  begin
    v_actor := nullif(v_headers ->> 'x-actor-id', '')::uuid;
  exception when invalid_text_representation then
    v_actor := null;
  end;
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  v_via := coalesce(nullif(v_headers ->> 'x-change-via', ''), 'system');
  if v_via not in ('staff_assistant', 'patient_assistant', 'dashboard', 'system') then
    v_via := 'system';
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  foreach v_column in array coalesce(tg_argv, array[]::text[]) loop
    v_old := v_old - v_column;
    v_new := v_new - v_column;
  end loop;

  -- Skip updates that changed nothing but the timestamp.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  insert into public.audit_log (actor_id, via, action, entity, entity_id, before, after)
  values (
    v_actor,
    v_via,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- ---------- everything that assumed Supabase Auth ----------
do $$
declare
  v_policy record;
begin
  for v_policy in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;

  if to_regclass('storage.objects') is not null then
    drop policy if exists knowledge_files_owner_all on storage.objects;
  end if;
end;
$$;

drop trigger on_auth_user_created on auth.users;
drop trigger on_auth_user_deleted on auth.users;
drop function public.handle_new_user();
drop function public.handle_deleted_user();

-- Sign-in checks now live in the backend (auth/normalizeName.js, services/authService.js).
drop function public.verify_patient_by_phone(text, text, date);
drop function public.find_patient_by_code(text);
drop function public.normalize_person_name(text);

drop function public.current_user_role();
drop function public.is_staff();
drop function public.is_owner();
drop function public.can_view_all();

-- ---------- no rights for the public keys ----------
do $$
declare
  v_table record;
begin
  for v_table in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', v_table.relname);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
