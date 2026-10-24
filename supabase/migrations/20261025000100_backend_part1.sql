-- Backend Part 1 additions: reschedule, atomic schedule edits, website bookings,
-- and hiding sign-in secrets on patients from logged-in users.

-- Bookings made on the website (not by an assistant, not by staff in the dashboard).
-- (A new enum value can't be used in the same transaction, so nothing below uses it.)
alter type public.booking_source add value if not exists 'website';

-- Reschedule: same permission rules as cancel_appointment. Patients only their own and only
-- outside the cancellation window of the CURRENT time; staff/owner anytime; viewer never.
-- The new time must be a real bookable slot; the exclusion constraints decide races.
-- Updating the same row means a booking never collides with its own old time.
create function public.reschedule_appointment(
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

-- Replace a doctor's whole weekly schedule in one step (all or nothing).
-- Runs as the caller, so RLS and the audit log see the real owner.
-- p_hours: [{"weekday": 0-6, "start_time": "10:00", "end_time": "18:00"}, ...]
create function public.set_working_hours(p_staff_id uuid, p_hours jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_owner() then
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

-- Replace the list of services a doctor offers in one step (all or nothing).
create function public.set_staff_services(p_staff_id uuid, p_service_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_owner() then
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

revoke execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) from public, anon;
revoke execute on function public.set_working_hours(uuid, jsonb) from public, anon;
revoke execute on function public.set_staff_services(uuid, uuid[]) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) to authenticated, service_role;
grant execute on function public.set_working_hours(uuid, jsonb) to authenticated;
grant execute on function public.set_staff_services(uuid, uuid[]) to authenticated;

-- Sign-in secrets stay server-side: logged-in users (even staff, even the patient
-- themselves) can no longer read or change the code fingerprint or lockout counters.
-- The backend (service_role) and the security-definer sign-in functions still can.
revoke all on public.patients from anon;
revoke select, update on public.patients from authenticated;
grant select (id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at, updated_at)
  on public.patients to authenticated;
grant update (full_name, date_of_birth, email, phone, preferred_language, notes)
  on public.patients to authenticated;
