-- Undoes 20261104000200_backend_auth_contract.sql: the database goes back to how Migration A left
-- it, with Row Level Security policies and rights for the public keys.
-- This is NOT a migration: it lives outside supabase/migrations so `db push` never runs it. Prefer
-- restoring the backup taken before Migration B; use this only if that isn't possible. Patients and
-- bookings added since stay. Patient profiles stay created, but the contact details cleared from
-- them are not brought back. Run it in the Supabase SQL editor, then remove the migration's row:
--   delete from supabase_migrations.schema_migrations where version = '20261104000200';

-- ---------- role helpers and the old sign-in functions ----------
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('staff', 'owner'), false);
$$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'owner', false);
$$;

create function public.can_view_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('staff', 'owner', 'viewer'), false);
$$;

create function public.normalize_person_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p_name, '')), '[ً-ْـ]', '', 'g'),
      'أإآٱىة',
      'اااايه'
    ),
    '\s+', ' ', 'g'
  ));
$$;

create function public.verify_patient_by_phone(p_phone text, p_full_name text, p_date_of_birth date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '');
  v_patient public.patients;
begin
  select * into v_patient from public.patients where phone = v_phone for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if v_patient.login_locked_until is not null and v_patient.login_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_patient.login_locked_until);
  end if;

  if public.normalize_person_name(v_patient.full_name) = public.normalize_person_name(p_full_name)
     and v_patient.date_of_birth = p_date_of_birth then
    update public.patients
    set login_failed_attempts = 0, login_locked_until = null
    where id = v_patient.id;
    return jsonb_build_object('ok', true, 'patient_id', v_patient.id, 'profile_id', v_patient.profile_id);
  end if;

  if v_patient.login_failed_attempts + 1 >= 5 then
    update public.patients
    set login_failed_attempts = 0, login_locked_until = now() + interval '15 minutes'
    where id = v_patient.id;
  else
    update public.patients
    set login_failed_attempts = login_failed_attempts + 1
    where id = v_patient.id;
  end if;
  return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
end;
$$;

create function public.find_patient_by_code(p_code_hmac text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'patient_id', p.id, 'profile_id', p.profile_id)
     from public.patients p
     where p.code_hmac = p_code_hmac),
    jsonb_build_object('ok', false, 'error', 'invalid_credentials')
  );
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email, phone, preferred_language)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.phone,
    coalesce((new.raw_user_meta_data ->> 'preferred_language')::public.lang, 'en')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- ---------- patients: a profile is optional again ----------
drop trigger patients_create_profile on public.patients;
drop function public.create_patient_profile();
alter table public.patients alter column profile_id drop not null;
alter table public.patients drop constraint patients_profile_id_fkey;
alter table public.patients
  add constraint patients_profile_id_fkey foreign key (profile_id) references public.profiles (id) on delete set null;
alter table public.profiles drop constraint profiles_patient_no_contact;

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
    insert into public.patients (full_name, date_of_birth, email, phone, preferred_language)
    values (v_name, p_date_of_birth, v_email, v_phone, p_preferred_language)
    on conflict do nothing
    returning * into v_patient;

    if v_patient.id is null then
      -- A concurrent booking registered this patient a moment ago: reuse that row.
      select * into v_patient
      from public.patients
      where (v_email is not null and email = v_email)
         or (v_phone is not null and phone = v_phone)
      limit 1;
    else
      v_is_new := true;
    end if;
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

-- ---------- functions and views with their role checks ----------
drop function public.cancel_appointment(uuid, text);
drop function public.reschedule_appointment(uuid, timestamptz, uuid);

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

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims  jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_actor   uuid := (select auth.uid());
  v_via     text;
  v_old     jsonb;
  v_new     jsonb;
  v_column  text;
begin
  if v_actor is null and coalesce(v_claims ->> 'role', '') = 'service_role' then
    begin
      v_actor := nullif(v_headers ->> 'x-actor-id', '')::uuid;
    exception when invalid_text_representation then
      v_actor := null;
    end;
  end if;
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  v_via := coalesce(
    nullif(v_headers ->> 'x-change-via', ''),
    case when (select auth.uid()) is not null then 'dashboard' else 'system' end
  );
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


-- ---------- policies ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy patients_select on public.patients for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_staff()));
create policy patients_update_staff on public.patients for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy staff_select on public.staff for select to anon, authenticated
  using (is_active or (select public.can_view_all()));
create policy staff_write on public.staff for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy services_select on public.services for select to anon, authenticated
  using (is_active or (select public.can_view_all()));
create policy services_write on public.services for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy staff_services_select on public.staff_services for select to anon, authenticated
  using (true);
create policy staff_services_write on public.staff_services for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy working_hours_select on public.working_hours for select to anon, authenticated
  using (true);
create policy working_hours_write on public.working_hours for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy clinic_settings_select on public.clinic_settings for select to anon, authenticated
  using (true);
create policy clinic_settings_update on public.clinic_settings for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy time_off_select on public.time_off for select to authenticated
  using ((select public.can_view_all()));
create policy time_off_write on public.time_off for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy appointments_select on public.appointments for select to authenticated
  using (
    (select public.can_view_all())
    or exists (
      select 1 from public.patients p
      where p.id = appointments.patient_id and p.profile_id = (select auth.uid())
    )
  );
create policy appointments_update_staff on public.appointments for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy escalations_select on public.escalations for select to authenticated
  using ((select public.can_view_all()));
create policy escalations_update_staff on public.escalations for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy notifications_select on public.notifications for select to authenticated
  using ((select public.is_owner()));
create policy conversations_select on public.conversations for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.can_view_all()));
create policy messages_select on public.messages for select to authenticated
  using (
    (select public.is_staff())
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.profile_id = (select auth.uid())
    )
  );
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (public.current_user_role() in ('owner', 'viewer'));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_owner()));
create policy knowledge_docs_select on public.knowledge_docs for select to anon, authenticated
  using ((is_published and ingest_status = 'ready') or (select public.can_view_all()));
create policy knowledge_docs_write on public.knowledge_docs for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy conversations_review_owner on public.conversations for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy patient_memories_owner on public.patient_memories for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy intake_fields_select on public.intake_fields for select to anon, authenticated
  using (is_active or (select public.can_view_all()));
create policy intake_fields_owner on public.intake_fields for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy knowledge_gaps_select on public.knowledge_gaps for select to authenticated
  using ((select public.current_user_role()) in ('owner', 'viewer'));
create policy knowledge_gaps_owner on public.knowledge_gaps for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy waitlist_select on public.waitlist for select to authenticated
  using (
    (select public.can_view_all())
    or exists (select 1 from public.patients p where p.id = waitlist.patient_id and p.profile_id = (select auth.uid()))
  );
create policy waitlist_staff_update on public.waitlist for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

do $$
begin
  if to_regclass('storage.objects') is not null then
    create policy knowledge_files_owner_all on storage.objects
        for all to authenticated
        using (bucket_id = 'knowledge-files' and (select public.is_owner()))
        with check (bucket_id = 'knowledge-files' and (select public.is_owner()));
  end if;
end;
$$;

-- ---------- rights: Supabase's defaults, then every grant and revoke the migrations made, in order ----------
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges grant execute on functions to public;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, phone, preferred_language) on public.profiles to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.is_staff()           to anon, authenticated;
grant execute on function public.is_owner()           to anon, authenticated;
grant execute on function public.can_view_all()       to anon, authenticated;
grant execute on function public.get_available_slots(uuid, uuid, date, boolean) to anon, authenticated;
grant execute on function public.cancel_appointment(uuid, text, uuid) to authenticated;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, date, text, text, public.lang, public.booking_source, text, uuid, text) to service_role;
grant execute on function public.cancel_appointment(uuid, text, uuid) to service_role;
grant execute on function public.verify_patient_by_phone(text, text, date) to service_role;
grant execute on function public.find_patient_by_code(text) to service_role;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, public.lang, double precision) to service_role;
grant execute on function public.normalize_person_name(text) to anon, authenticated, service_role;
grant execute on function public.mask_email(text) to authenticated, service_role;
grant execute on function public.mask_phone(text) to authenticated, service_role;
grant execute on function public.mask_text(text) to authenticated, service_role;
grant execute on function public.mask_person_name(text) to authenticated, service_role;
revoke all on public.v_patients, public.v_profiles, public.v_appointments, public.v_messages,
  public.v_notifications, public.v_audit_log, public.v_stats_today,
  public.v_stats_upcoming_by_doctor, public.v_ai_outcomes_7d
  from public, anon;
grant select on public.v_patients, public.v_profiles, public.v_appointments, public.v_messages,
  public.v_notifications, public.v_audit_log, public.v_stats_today,
  public.v_stats_upcoming_by_doctor, public.v_ai_outcomes_7d
  to authenticated, service_role;
revoke execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) from public, anon;
revoke execute on function public.set_working_hours(uuid, jsonb) from public, anon;
revoke execute on function public.set_staff_services(uuid, uuid[]) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) to authenticated, service_role;
grant execute on function public.set_working_hours(uuid, jsonb) to authenticated;
grant execute on function public.set_staff_services(uuid, uuid[]) to authenticated;
revoke all on public.patients from anon;
revoke select, update on public.patients from authenticated;
grant select (id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at, updated_at)
  on public.patients to authenticated;
grant update (full_name, date_of_birth, email, phone, preferred_language, notes)
  on public.patients to authenticated;
revoke execute on function public.claim_jobs(integer) from public, anon, authenticated;
revoke execute on function public.match_conversation_summaries(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer) to service_role;
grant execute on function public.match_conversation_summaries(uuid, extensions.vector, integer, double precision) to service_role;
revoke all on public.jobs from anon, authenticated;
revoke execute on function public.queue_due_reminders(text, integer) from public, anon, authenticated;
revoke execute on function public.purge_expired_conversations(integer) from public, anon, authenticated;
grant execute on function public.queue_due_reminders(text, integer) to service_role;
grant execute on function public.purge_expired_conversations(integer) to service_role;
revoke execute on function public.handle_deleted_user() from public, anon, authenticated;
revoke all on public.profiles from anon;
revoke select on public.profiles from authenticated;
grant select (id, role, full_name, email, phone, preferred_language, created_at, updated_at)
  on public.profiles to authenticated;
revoke all on public.auth_sessions, public.login_codes from anon, authenticated;
grant select, insert, update, delete on public.auth_sessions, public.login_codes to service_role;
grant execute on function public.current_user_role() to service_role;
grant execute on function public.can_view_all()      to service_role;
grant execute on function public.is_owner()          to service_role;
revoke all on public.v_patients_masked, public.v_profiles_masked, public.v_appointments_masked,
  public.v_messages_masked, public.v_notifications_masked, public.v_audit_log_masked
  from public, anon, authenticated;
grant select on public.v_patients_masked, public.v_profiles_masked, public.v_appointments_masked,
  public.v_messages_masked, public.v_notifications_masked, public.v_audit_log_masked
  to service_role;
grant execute on function public.set_working_hours(uuid, jsonb) to service_role;
grant execute on function public.set_staff_services(uuid, uuid[]) to service_role;
