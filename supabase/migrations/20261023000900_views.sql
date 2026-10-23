-- Views for dashboards and the staff assistant.
--
-- These run with the view owner's rights (bypassing table RLS), so each one checks
-- can_view_all() itself and masks personal data when the caller is the read-only viewer.
-- Reporting views (v_stats_*, v_ai_*) contain no personal data.

create function public.mask_person_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- "Ahmed Mahmoud Ali" → "Ahmed M."
  select case
    when p_name is null then null
    when split_part(btrim(p_name), ' ', 2) = '' then split_part(btrim(p_name), ' ', 1)
    else split_part(btrim(p_name), ' ', 1) || ' ' || left(split_part(btrim(p_name), ' ', 2), 1) || '.'
  end;
$$;

grant execute on function public.mask_person_name(text) to authenticated, service_role;

create view public.v_patients as
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
where public.can_view_all();

create view public.v_profiles as
select
  pr.id,
  pr.role,
  case when public.current_user_role() = 'viewer' then public.mask_person_name(pr.full_name) else pr.full_name end as full_name,
  case when public.current_user_role() = 'viewer' then public.mask_email(pr.email::text) else pr.email::text end as email,
  case when public.current_user_role() = 'viewer' then public.mask_phone(pr.phone) else pr.phone end as phone,
  pr.preferred_language,
  pr.created_at
from public.profiles pr
where public.can_view_all();

-- Appointment list with names, for the schedule screens.
create view public.v_appointments as
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
where public.can_view_all();

create view public.v_messages as
select
  m.id,
  m.conversation_id,
  m.role,
  case when public.current_user_role() = 'viewer' then public.mask_text(m.content) else m.content end as content,
  m.tool_name,
  case when public.current_user_role() = 'viewer' then null else m.tool_payload end as tool_payload,
  m.created_at
from public.messages m
where public.can_view_all();

create view public.v_notifications as
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
where public.current_user_role() in ('owner', 'viewer');

create view public.v_audit_log as
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
where public.current_user_role() in ('owner', 'viewer');

-- Today's numbers (clinic timezone). Answers "how many patients registered today?".
create view public.v_stats_today as
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
where public.can_view_all();

-- Booked appointments per doctor over the next 7 days.
create view public.v_stats_upcoming_by_doctor as
select
  st.id as staff_id,
  st.full_name_en,
  st.full_name_ar,
  count(a.id) filter (where a.status = 'booked' and a.starts_at >= now() and a.starts_at < now() + interval '7 days') as booked_next_7_days
from public.staff st
left join public.appointments a on a.staff_id = st.id
where public.can_view_all()
group by st.id, st.full_name_en, st.full_name_ar;

-- What the assistants did over the last 7 days (answered / booked / escalated / …).
create view public.v_ai_outcomes_7d as
select
  r.assistant,
  r.outcome,
  count(*) as runs,
  round(avg(r.latency_ms)) as avg_latency_ms
from public.agent_runs r
where r.created_at >= now() - interval '7 days'
  and public.can_view_all()
group by r.assistant, r.outcome;

revoke all on public.v_patients, public.v_profiles, public.v_appointments, public.v_messages,
  public.v_notifications, public.v_audit_log, public.v_stats_today,
  public.v_stats_upcoming_by_doctor, public.v_ai_outcomes_7d
  from public, anon;
grant select on public.v_patients, public.v_profiles, public.v_appointments, public.v_messages,
  public.v_notifications, public.v_audit_log, public.v_stats_today,
  public.v_stats_upcoming_by_doctor, public.v_ai_outcomes_7d
  to authenticated, service_role;
