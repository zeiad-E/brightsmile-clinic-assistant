-- Core logic: name/contact helpers, free slots, booking, cancellation, sign-in checks, knowledge search.

-- Compare names typed differently: case, extra spaces, Arabic letter variants, diacritics.
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

-- Masking for the read-only viewer role.
create function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when position('@' in p_email) > 1 then left(p_email, 1) || '***' || substr(p_email, position('@' in p_email))
    else '***'
  end;
$$;

create function public.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when length(p_phone) > 7 then left(p_phone, 5) || repeat('*', length(p_phone) - 7) || right(p_phone, 2)
    else '***'
  end;
$$;

-- Hide emails and phone numbers inside free text (chat messages, notes).
create function public.mask_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      p_text,
      '([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})',
      '\1***@\2',
      'g'
    ),
    '\+?[0-9٠-٩]{2,}(?:[\s-]?[0-9٠-٩]{3,}){2,}',
    '[phone hidden]',
    'g'
  );
$$;

-- Free start times for one doctor, one service, one day (clinic timezone).
-- Working hours → every slot_step → whole service must fit → minus booked appointments
-- and time off → minus anything earlier than the lead time or beyond the horizon.
-- p_ignore_bookings = true answers "would this be a slot if nothing were booked?"
-- (used to tell "slot taken" apart from "not a valid time").
create function public.get_available_slots(
  p_service_id      uuid,
  p_staff_id        uuid,
  p_date            date,
  p_ignore_bookings boolean default false
)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select timezone, slot_step_minutes, min_lead_minutes, booking_horizon_days
    from public.clinic_settings
    where id = 1
  ),
  service as (
    select s.duration_minutes
    from public.services s
    join public.staff_services ss on ss.service_id = s.id and ss.staff_id = p_staff_id
    join public.staff st on st.id = ss.staff_id
    where s.id = p_service_id and s.is_active and st.is_active
  ),
  shifts as (
    select
      (p_date + wh.start_time) at time zone settings.timezone as shift_start,
      (p_date + wh.end_time) at time zone settings.timezone as shift_end
    from public.working_hours wh, settings
    where wh.staff_id = p_staff_id
      and wh.weekday = extract(dow from p_date)::smallint
  ),
  candidates as (
    select
      gs as slot_start,
      gs + make_interval(mins => service.duration_minutes) as slot_end
    from shifts, settings, service,
      generate_series(
        shifts.shift_start,
        shifts.shift_end - make_interval(mins => service.duration_minutes),
        make_interval(mins => settings.slot_step_minutes)
      ) as gs
  )
  select c.slot_start, c.slot_end
  from candidates c, settings
  where c.slot_start >= now() + make_interval(mins => settings.min_lead_minutes)
    and c.slot_start < now() + make_interval(days => settings.booking_horizon_days)
    and (p_ignore_bookings or not exists (
      select 1 from public.appointments a
      where a.staff_id = p_staff_id
        and a.status = 'booked'
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    ))
    and not exists (
      select 1 from public.time_off t
      where (t.staff_id = p_staff_id or t.staff_id is null)
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)')
    )
  order by c.slot_start;
$$;

-- Book an appointment = find or register the patient + insert the booking, atomically.
-- Returns jsonb: { ok: true, appointment_id, patient_id, profile_id, is_new_patient, replayed, starts_at, ends_at }
--            or  { ok: false, error: '<code>' }.
-- Error codes: name_required, contact_required, invalid_email, invalid_phone, invalid_date_of_birth,
--              slot_taken, slot_unavailable, contact_conflict, identity_mismatch, patient_has_overlap.
create function public.book_appointment(
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

-- Cancel: patients only their own and only until the cancellation window; staff/owner anytime;
-- viewer never. Signed-in users act as themselves; only the server may pass p_actor.
create function public.cancel_appointment(p_appointment_id uuid, p_reason text default null, p_actor uuid default null)
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

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = p_appointment_id;

  return jsonb_build_object('ok', true, 'appointment_id', p_appointment_id);
end;
$$;

-- Phone sign-in: phone + full name + date of birth. 5 wrong tries → 15-minute lock.
-- The row lock makes the attempt counter safe under concurrent requests.
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

-- Personal-code sign-in: the backend sends the HMAC of the typed code (never the code itself).
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

-- Knowledge search for RAG: nearest chunks by cosine similarity, small boost for the
-- patient's language, with the doc title for citations.
create function public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_count     integer default 5,
  p_language      public.lang default null,
  min_similarity  double precision default 0.25
)
returns table (
  chunk_id   uuid,
  doc_id     uuid,
  title      text,
  category   text,
  language   public.lang,
  content    text,
  similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select *
  from (
    select
      c.id as chunk_id,
      d.id as doc_id,
      d.title,
      d.category,
      d.language,
      c.content,
      1 - (c.embedding <=> query_embedding) as similarity
    from public.knowledge_chunks c
    join public.knowledge_docs d on d.id = c.doc_id
    where d.is_published and d.ingest_status = 'ready'
  ) ranked
  where ranked.similarity >= min_similarity
  order by ranked.similarity + case when p_language is not null and ranked.language = p_language then 0.05 else 0 end desc
  limit match_count;
$$;
