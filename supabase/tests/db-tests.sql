-- Database tests: booking rules, race guards, sign-in, cancellation, security (RLS),
-- masking, audit log and knowledge search. Run with supabase/tests/run-local.sh.
-- Every check prints "PASS: …" or raises "FAIL: …".

\set ON_ERROR_STOP 0

create schema test;
grant usage on schema test to public;

create function test.assert(p_ok boolean, p_name text) returns text language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
  return 'PASS';
end;
$$;
grant execute on function test.assert(boolean, text) to public;

-- Test day: 3 days ahead in clinic time (well past the 2 h lead and 24 h cancel window).
create function test.day(p_offset integer default 3) returns date language sql stable as $$
  select (now() at time zone 'Africa/Cairo')::date + p_offset;
$$;
create function test.at(p_time time, p_offset integer default 3) returns timestamptz language sql stable as $$
  select (test.day(p_offset) + p_time) at time zone 'Africa/Cairo';
$$;
grant execute on all functions in schema test to public;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local',   '{"role":"owner"}',  '{"full_name":"Olivia Owner"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@test.local',   '{"role":"staff"}',  '{"full_name":"Sam Staff"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local',  '{"role":"viewer"}', '{"full_name":"Vera Viewer"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'patient@test.local', '{}',                '{"full_name":"Paul Patient"}');

insert into public.clinic_settings (id, name_en, name_ar) values (1, 'Test Clinic', 'عيادة الاختبار');

insert into public.services (id, slug, name_en, name_ar, duration_minutes, price_egp) values
  ('00000000-0000-0000-0000-0000000000c1', 'teeth-cleaning', 'Teeth cleaning', 'تنظيف الأسنان', 30, 500),
  ('00000000-0000-0000-0000-0000000000c2', 'whitening', 'Whitening', 'تبييض', 60, 2500);

insert into public.staff (id, full_name_en, full_name_ar, title) values
  ('00000000-0000-0000-0000-0000000000b1', 'Dr. Amal', 'د. أمل', 'dentist'),
  ('00000000-0000-0000-0000-0000000000b2', 'Dr. Bassem', 'د. باسم', 'dentist');

insert into public.staff_services (staff_id, service_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1');

-- Every day 10:00–18:00 for both doctors, so tests don't depend on the weekday.
insert into public.working_hours (staff_id, weekday, start_time, end_time)
select s.id, d, time '10:00', time '18:00'
from public.staff s, generate_series(0, 6) d;

-- ---------- profiles ----------
select test.assert((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'owner',
  'new login gets a profile with the role from app_metadata');
select test.assert((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a4') = 'patient',
  'new login without a role defaults to patient');

-- ---------- free slots ----------
select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day())) = 31,
  'free slots: 10:00–18:00, 30-min service, every 15 min = 31 start times');

select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', test.day())) = 0,
  'free slots: none when the doctor does not offer the service');

select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day(0))
   where slot_start < now() + interval '2 hours') = 0,
  'free slots: nothing earlier than the 2-hour lead time');

select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day(40))) = 0,
  'free slots: nothing beyond the 30-day horizon');

-- ---------- booking ----------
select test.assert(
  (public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('10:00'),
     'Paul Patient', '1990-01-01', p_email => 'Paul@Example.com') ->> 'is_new_patient')::boolean,
  'booking registers a new patient');

select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day())) = 29,
  'booked 10:00–10:30 removes the 10:00 and 10:15 starts (31 → 29)');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('10:00'),
    'Other Person', '1980-02-02', p_email => 'other@example.com') ->> 'error' = 'slot_taken',
  'same slot again → slot_taken');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('10:07'),
    'Other Person', '1980-02-02', p_email => 'other@example.com') ->> 'error' = 'slot_unavailable',
  'a time that is not a slot start → slot_unavailable');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('12:00'),
    'Paul Patient', '1999-09-09', p_email => 'paul@example.com') ->> 'error' = 'identity_mismatch',
  'existing patient with a different date of birth → identity_mismatch');

select test.assert(
  (public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('14:00'),
     'paul patient', '1990-01-01', p_email => 'PAUL@example.com') ->> 'is_new_patient')::boolean = false,
  'existing patient (email in any case) is reused, not duplicated');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('10:00'),
    'Paul Patient', '1990-01-01', p_email => 'paul@example.com') ->> 'error' = 'patient_has_overlap',
  'same patient at the same time with another doctor → patient_has_overlap');

select test.assert(
  (select (r1 ->> 'appointment_id') = (r2 ->> 'appointment_id') and (r2 ->> 'replayed')::boolean
   from (select
     public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('11:00'),
       'Nour Ali', '1995-03-03', p_email => 'nour@example.com', p_idempotency_key => 'retry-1') as r1) a,
   lateral (select
     public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('11:00'),
       'Nour Ali', '1995-03-03', p_email => 'nour@example.com', p_idempotency_key => 'retry-1') as r2) b),
  'retried request with the same idempotency key returns the same booking');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('15:00'),
    'Mixed Up', '1990-01-01', p_email => 'paul@example.com', p_phone => '+201112223334') ->> 'ok' = 'true'
  and public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('16:00'),
    'Someone', '1970-01-01', p_email => 'nour@example.com', p_phone => '+201112223334') ->> 'error' = 'contact_conflict',
  'email of one patient + phone of another → contact_conflict');

select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('16:00'),
    'X', '1970-01-01') ->> 'error' = 'contact_required',
  'no email and no phone → contact_required');

-- Race guard: an overlapping insert that skips the function is still rejected by the database.
do $$
begin
  insert into public.appointments (patient_id, staff_id, service_id, starts_at, ends_at, source)
  select p.id, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', test.at('10:15'), test.at('10:15'), 'dashboard'
  from public.patients p where p.email = 'nour@example.com';
  raise exception 'FAIL: overlapping insert was accepted';
exception when exclusion_violation then
  raise notice 'PASS: database rejects overlapping bookings even outside book_appointment (race guard)';
end;
$$;

do $$
begin
  insert into public.working_hours (staff_id, weekday, start_time, end_time)
  values ('00000000-0000-0000-0000-0000000000b1', 1, '17:00', '19:00');
  raise exception 'FAIL: overlapping shift was accepted';
exception when exclusion_violation then
  raise notice 'PASS: overlapping working-hours shifts are rejected';
end;
$$;

-- ---------- time off ----------
insert into public.time_off (staff_id, starts_at, ends_at, reason)
values (null, test.at('00:00', 5), test.at('23:59', 5), 'Clinic closed');
select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day(5))) = 0,
  'clinic-wide time off removes all slots that day');

-- ---------- phone sign-in ----------
select public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('12:00'),
  'أحمد  محمود', '1985-05-05', p_phone => '+20 100 123 4567');

select test.assert(
  public.verify_patient_by_phone('+201001234567', 'احمد محمود', '1985-05-05') ->> 'ok' = 'true',
  'phone sign-in matches the name despite Arabic letter variants and extra spaces');

select test.assert(
  public.verify_patient_by_phone('+201001234567', 'احمد محمود', '1985-06-06') ->> 'error' = 'invalid_credentials',
  'phone sign-in with the wrong date of birth fails');

select public.verify_patient_by_phone('+201001234567', 'wrong', '1985-05-05') from generate_series(1, 4);
select test.assert(
  public.verify_patient_by_phone('+201001234567', 'احمد محمود', '1985-05-05') ->> 'error' = 'locked',
  'after 5 wrong tries the account is locked, even for the right answer');

-- ---------- cancellation ----------
update public.patients set profile_id = '00000000-0000-0000-0000-0000000000a4' where email = 'paul@example.com';

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select test.assert(
  public.cancel_appointment((select id from public.appointments where starts_at = test.at('14:00') and staff_id = '00000000-0000-0000-0000-0000000000b1')) ->> 'ok' = 'true',
  'patient cancels own booking more than 24 h ahead');
commit;

-- Move one of Paul's bookings to 5 hours from now (inside the 24 h window).
update public.appointments set starts_at = date_trunc('minute', now()) + interval '5 hours'
where starts_at = test.at('15:00') and staff_id = '00000000-0000-0000-0000-0000000000b2';

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select test.assert(
  public.cancel_appointment((select id from public.appointments where staff_id = '00000000-0000-0000-0000-0000000000b2' and starts_at < now() + interval '6 hours')) ->> 'error' = 'too_late',
  'patient cannot cancel inside the 24 h window');
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select test.assert(
  public.cancel_appointment((select id from public.appointments where staff_id = '00000000-0000-0000-0000-0000000000b2' and starts_at < now() + interval '6 hours')) ->> 'error' = 'read_only',
  'viewer cannot cancel anything');
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select test.assert(
  public.cancel_appointment((select id from public.appointments where staff_id = '00000000-0000-0000-0000-0000000000b2' and starts_at < now() + interval '6 hours')) ->> 'ok' = 'true',
  'staff can cancel inside the 24 h window');
commit;

-- ---------- security: viewer ----------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select test.assert((select count(*) from public.patients) = 0, 'viewer cannot read the raw patients table');
select test.assert((select count(*) from public.v_patients) > 0, 'viewer can read the patients view');
select test.assert((select bool_and(email is null or email like '_***@%') from public.v_patients), 'viewer sees emails masked');
select test.assert((select bool_and(phone is null or phone like '%*%') from public.v_patients), 'viewer sees phones masked');
select test.assert((select bool_and(date_of_birth is null) from public.v_patients), 'viewer does not see dates of birth');
select test.assert((select count(*) from public.appointments) > 0, 'viewer can read appointments');
select test.assert((select count(*) from public.v_stats_today) = 1, 'viewer can read today''s stats');
select test.assert((select count(*) from public.knowledge_chunks) = 0, 'viewer cannot read knowledge chunks');
update public.services set price_egp = 1 where slug = 'teeth-cleaning';
commit;
select test.assert((select price_egp from public.services where slug = 'teeth-cleaning') = 500,
  'viewer price change has no effect (read-only enforced by the database)');

-- ---------- security: patient ----------
select count(*) as paul_appointments
from public.appointments a join public.patients p on p.id = a.patient_id
where p.email = 'paul@example.com' \gset
select test.assert((select count(*) from public.appointments) > :paul_appointments,
  'fixture: other patients have appointments too');

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select test.assert((select count(*) from public.patients) = 1, 'patient sees only their own patient record');
select test.assert((select count(*) from public.appointments) = :paul_appointments,
  'patient sees only their own appointments');
select test.assert((select count(*) from public.v_patients) = 0, 'patient cannot use the staff views');
commit;

-- ---------- security: anonymous visitor ----------
begin;
set local role anon;
select test.assert((select count(*) from public.services) = 2, 'visitor can read the service catalog');
select test.assert((select count(*) from public.patients) = 0, 'visitor cannot read patients');
select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day())) > 0,
  'visitor can look up free slots');
do $$
begin
  perform public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('17:00'),
    'Hacker', '1990-01-01', p_email => 'h@example.com');
  raise exception 'FAIL: visitor could call book_appointment directly';
exception when insufficient_privilege then
  raise notice 'PASS: visitor cannot call book_appointment directly (server only)';
end;
$$;
commit;

-- ---------- audit log ----------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update public.services set price_egp = 600 where slug = 'teeth-cleaning';
commit;
select test.assert(
  (select actor_id = '00000000-0000-0000-0000-0000000000a1' and via = 'dashboard'
     and (before ->> 'price_egp')::numeric = 500 and (after ->> 'price_egp')::numeric = 600
   from public.audit_log where entity = 'services' order by id desc limit 1),
  'owner price change is audited with actor and before/after values');

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.headers = '{"x-actor-id":"00000000-0000-0000-0000-0000000000a1","x-change-via":"staff_assistant"}';
update public.services set price_egp = 650 where slug = 'teeth-cleaning';
commit;
select test.assert(
  (select actor_id = '00000000-0000-0000-0000-0000000000a1' and via = 'staff_assistant'
   from public.audit_log where entity = 'services' order by id desc limit 1),
  'change made by the staff assistant is audited for the user it acted for');

-- ---------- knowledge search ----------
create function test.basis(k integer) returns extensions.vector language sql immutable as $$
  select (select array_agg(case when i = k then 1.0 when i = k + 1 then 0.2 else 0 end order by i)
          from generate_series(1, 768) i)::real[]::extensions.vector;
$$;

insert into public.knowledge_docs (id, group_key, language, category, title, content, ingest_status) values
  ('00000000-0000-0000-0000-0000000000d1', 'hours', 'en', 'hours', 'Opening hours', 'Sat–Thu 10:00–18:00', 'ready'),
  ('00000000-0000-0000-0000-0000000000d2', 'hours', 'ar', 'hours', 'مواعيد العمل', 'السبت–الخميس ١٠–٦', 'ready'),
  ('00000000-0000-0000-0000-0000000000d3', 'pricing', 'en', 'pricing', 'Prices', 'Cleaning 500 EGP', 'pending');
insert into public.knowledge_chunks (doc_id, chunk_index, content, embedding) values
  ('00000000-0000-0000-0000-0000000000d1', 0, 'Sat–Thu 10:00–18:00', test.basis(1)),
  ('00000000-0000-0000-0000-0000000000d2', 0, 'السبت–الخميس ١٠–٦', test.basis(1)),
  ('00000000-0000-0000-0000-0000000000d3', 0, 'Cleaning 500 EGP', test.basis(1));

select test.assert(
  (select language from public.match_knowledge_chunks(test.basis(1), 5, 'ar') limit 1) = 'ar',
  'knowledge search prefers the patient''s language when matches are equally close');
select test.assert(
  (select count(*) from public.match_knowledge_chunks(test.basis(1), 5, 'en') where title = 'Prices') = 0,
  'knowledge search ignores docs that are not ready yet');
select test.assert(
  (select count(*) from public.match_knowledge_chunks(test.basis(300), 5, 'en')) = 0,
  'knowledge search drops unrelated chunks below the similarity threshold');

-- ---------- helpers ----------
select test.assert(
  public.mask_text('Call 01001234567 or ahmed@gmail.com on 2026-11-10') = 'Call [phone hidden] or a***@gmail.com on 2026-11-10',
  'masking hides phones and emails but keeps dates');
select test.assert(public.mask_person_name('Ahmed Mahmoud Ali') = 'Ahmed M.', 'names are shortened for the viewer');
