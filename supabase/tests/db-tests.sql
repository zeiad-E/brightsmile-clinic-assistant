-- Database tests: booking rules, race guards, the patient-profile rule, what the public keys can
-- reach, masking, audit log and knowledge search. Run with supabase/tests/run-local.sh.
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
insert into public.profiles (id, role, full_name, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner',   'Olivia Owner', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff',   'Sam Staff',    'staff@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer',  'Vera Viewer',  'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'patient', 'Paul Patient', null);

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

-- One doctor off: only that doctor loses the day, the other doctor keeps every slot.
insert into public.time_off (staff_id, starts_at, ends_at, reason)
values ('00000000-0000-0000-0000-0000000000b1', test.at('00:00', 8), test.at('00:00', 9), 'Dr. Amal off');
select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day(8))) = 0,
  'a doctor''s time off removes that doctor''s slots');
select test.assert(
  (select count(*) from public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.day(8))) = 31,
  'a doctor''s time off leaves the other doctor free');
delete from public.time_off where reason = 'Dr. Amal off';

-- ---------- Arabic name, phone only ----------
select public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', test.at('12:00'),
  'أحمد  محمود', '1985-05-05', p_phone => '+20 100 123 4567');
select test.assert((select full_name = 'أحمد محمود' from public.patients where phone = '+201001234567'),
  'booking tidies the name and phone before saving');

-- ---------- one patient, one profile ----------
select test.assert(not exists (select 1 from public.patients where profile_id is null), 'every patient has a profile');
select test.assert(
  (select pr.role = 'patient' and pr.full_name = 'Paul Patient' and pr.email is null and pr.phone is null
   from public.patients p join public.profiles pr on pr.id = p.profile_id where p.email = 'paul@example.com'),
  'a new patient gets a patient profile, with their contact details left on the patient record');

select count(*) as profiles_before from public.profiles \gset
do $$
begin
  insert into public.patients (full_name, date_of_birth, email) values ('Duplicate', '1990-01-01', 'paul@example.com');
  raise exception 'FAIL: a second patient with the same email was accepted';
exception when unique_violation then
  raise notice 'PASS: a patient email is unique';
end;
$$;
select test.assert((select count(*) from public.profiles) = :profiles_before,
  'a patient insert that fails leaves no profile behind (the race in book_appointment)');

insert into public.patients (full_name, date_of_birth, phone, profile_id)
values ('Linked Already', '1990-01-01', '+201000000055', '00000000-0000-0000-0000-0000000000a4');
select test.assert((select count(*) from public.profiles) = :profiles_before,
  'a patient who comes with a profile does not get a second one');

do $$
begin
  update public.patients set profile_id = null where email = 'paul@example.com';
  raise exception 'FAIL: a patient lost their profile';
exception when not_null_violation then
  raise notice 'PASS: a patient must have a profile';
end;
$$;

do $$
begin
  delete from public.profiles where id = (select profile_id from public.patients where email = 'paul@example.com');
  raise exception 'FAIL: a patient''s profile was deleted';
exception when restrict_violation then
  raise notice 'PASS: a profile can''t be deleted while its patient exists';
end;
$$;

do $$
begin
  update public.profiles set email = 'someone@example.com' where id = '00000000-0000-0000-0000-0000000000a4';
  raise exception 'FAIL: a patient profile got an email';
exception when check_violation then
  raise notice 'PASS: a patient profile holds no contact details';
end;
$$;

-- ---------- audit log ----------
begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.headers = '{"x-actor-id":"00000000-0000-0000-0000-0000000000a1","x-change-via":"dashboard"}';
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

-- ---------- reschedule (backend part 1) ----------
-- Day 4 is free of other fixtures. Paul (a4) books 10:00; another patient books 11:00.
select public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('10:00', 4),
  'Paul Patient', '1990-01-01', p_email => 'paul@example.com');
select public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('11:00', 4),
  'Rana Reschedule', '1991-02-02', p_email => 'rana@example.com');

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select test.assert(
  public.reschedule_appointment(
    (select id from public.appointments where starts_at = test.at('10:00', 4) and status = 'booked'),
    test.at('10:15', 4)) ->> 'ok' = 'true',
  'a booking moves by 15 minutes (overlapping its own old time is fine)');
select test.assert(
  public.reschedule_appointment(
    (select id from public.appointments where starts_at = test.at('10:15', 4) and status = 'booked'),
    test.at('11:00', 4)) ->> 'error' = 'slot_taken',
  'reschedule into a booked time is refused as slot_taken');
select test.assert(
  public.reschedule_appointment(
    (select id from public.appointments where starts_at = test.at('10:15', 4) and status = 'booked'),
    test.at('03:00', 4)) ->> 'error' = 'slot_unavailable',
  'reschedule outside working hours is refused as slot_unavailable');
commit;

select test.assert(
  (select ends_at - starts_at from public.appointments where starts_at = test.at('10:15', 4)) = interval '30 minutes',
  'rescheduled booking keeps the service duration');

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select test.assert(
  public.reschedule_appointment(
    (select id from public.appointments where starts_at = test.at('11:00', 4) and status = 'booked'),
    test.at('12:00', 4), '00000000-0000-0000-0000-0000000000b2') ->> 'ok' = 'true',
  'a booking moves to another doctor and time');
commit;

select test.assert(
  (select staff_id from public.appointments where starts_at = test.at('12:00', 4) and status = 'booked') = '00000000-0000-0000-0000-0000000000b2',
  'reschedule to another doctor is saved');

-- ---------- schedule edits (backend part 1) ----------
begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select test.assert(
  public.set_working_hours('00000000-0000-0000-0000-0000000000b2',
    '[{"weekday":1,"start_time":"09:00","end_time":"13:00"},{"weekday":1,"start_time":"14:00","end_time":"17:00"}]') ->> 'count' = '2',
  'a doctor''s weekly schedule is replaced in one step');
select test.assert(
  public.set_working_hours('00000000-0000-0000-0000-0000000000b2',
    '[{"weekday":2,"start_time":"09:00","end_time":"13:00"},{"weekday":2,"start_time":"12:00","end_time":"15:00"}]') ->> 'error' = 'overlapping_shifts',
  'overlapping shifts are refused');
select test.assert(
  (select count(*) from public.working_hours where staff_id = '00000000-0000-0000-0000-0000000000b2') = 2,
  'a refused schedule change leaves the old schedule untouched (all or nothing)');
select test.assert(
  public.set_staff_services('00000000-0000-0000-0000-0000000000b2',
    array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[]) ->> 'count' = '2',
  'the services a doctor offers are replaced in one step');
select test.assert(
  public.set_staff_services('00000000-0000-0000-0000-0000000000b2',
    array['00000000-0000-0000-0000-0000000000ff']::uuid[]) ->> 'error' = 'unknown_service',
  'an unknown service is refused');
commit;
select test.assert(
  public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('16:00', 4),
    'Web Visitor', '1993-03-03', p_email => 'web@example.com', p_source => 'website') ->> 'ok' = 'true',
  'bookings can be marked as made on the website');

-- ---------- reminders, chat retention, recurring jobs (part 2a, step 5) ----------
insert into public.staff (id, full_name_en, full_name_ar, title) values
  ('00000000-0000-0000-0000-0000000000b9', 'Dr. Reminder', 'د. تذكير', 'dentist');
insert into public.patients (id, full_name, date_of_birth, email, phone) values
  ('00000000-0000-0000-0000-0000000000e1', 'Rana Remind', '1990-01-01', 'rana.remind@example.com', null),
  ('00000000-0000-0000-0000-0000000000e2', 'Phone Only', '1990-01-01', 'p201000000099@patients.brightsmile.app', '+201000000099'),
  ('00000000-0000-0000-0000-0000000000e3', 'No Email', '1990-01-01', null, '+201000000098');

-- Bookings made two days ago (except one), at chosen distances from now.
insert into public.appointments (id, patient_id, staff_id, service_id, starts_at, status, source, created_at) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '30 hours', 'booked', 'website', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '60 hours', 'booked', 'website', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 hour', 'booked', 'website', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '31 hours', 'booked', 'website', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '32 hours', 'booked', 'website', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f006', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '33 hours', 'booked', 'website', now()),
  ('00000000-0000-0000-0000-00000000f007', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c1', now() + interval '34 hours', 'cancelled', 'website', now() - interval '2 days');

select test.assert(public.queue_due_reminders('patients.brightsmile.app') = 1,
  'reminders: only an active booking 2–48 h away, booked over 12 h ago, with a real email is due');
select test.assert(
  (select count(*) from public.jobs where type = 'send_reminder' and payload ->> 'appointment_id' = '00000000-0000-0000-0000-00000000f001') = 1
  and (select reminder_sent_at is not null from public.appointments where id = '00000000-0000-0000-0000-00000000f001'),
  'reminders: the due booking is marked and gets one send_reminder job');
select test.assert(public.queue_due_reminders('patients.brightsmile.app') = 0,
  'reminders: a second sweep never queues the same reminder again');
select test.assert(
  not exists (select 1 from public.audit_log where entity_id = '00000000-0000-0000-0000-00000000f001' and action = 'appointments.update'),
  'reminders: marking a reminder is not written to the audit log');

update public.appointments set starts_at = starts_at - interval '1 hour' where id = '00000000-0000-0000-0000-00000000f001';
select test.assert(
  (select reminder_sent_at is null from public.appointments where id = '00000000-0000-0000-0000-00000000f001'),
  'reminders: moving a booking clears its reminder mark');
select test.assert(public.queue_due_reminders('patients.brightsmile.app') = 1,
  'reminders: a moved booking gets a reminder for its new time');

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
  perform public.queue_due_reminders('x');
  raise exception 'FAIL: a logged-in user could run the reminder sweep';
exception when insufficient_privilege then
  raise notice 'PASS: only the backend can run the reminder sweep';
end;
$$;

-- Retention (default 90 days).
insert into public.conversations (id, assistant, last_message_at) values
  ('00000000-0000-0000-0000-00000000d001', 'patient', now() - interval '100 days'),
  ('00000000-0000-0000-0000-00000000d002', 'patient', now() - interval '100 days'),
  ('00000000-0000-0000-0000-00000000d003', 'patient', now() - interval '5 days');
insert into public.escalations (conversation_id, reason) values ('00000000-0000-0000-0000-00000000d002', 'Waiting for staff');

select test.assert(public.purge_expired_conversations() = 1, 'retention: one chat is past the retention period');
select test.assert(
  not exists (select 1 from public.conversations where id = '00000000-0000-0000-0000-00000000d001')
  and exists (select 1 from public.conversations where id = '00000000-0000-0000-0000-00000000d002')
  and exists (select 1 from public.conversations where id = '00000000-0000-0000-0000-00000000d003'),
  'retention: old chats are deleted, but not recent ones or ones with an open escalation');

-- Recurring jobs: one waiting copy per type.
insert into public.jobs (type, payload) values ('nightly_cleanup', '{"recurring": true}');
do $$
begin
  insert into public.jobs (type, payload) values ('nightly_cleanup', '{"recurring": true}');
  raise exception 'FAIL: a second waiting copy of a recurring job was accepted';
exception when unique_violation then
  raise notice 'PASS: a recurring job has at most one waiting copy';
end;
$$;
update public.jobs set status = 'done' where type = 'nightly_cleanup';
insert into public.jobs (type, payload) values ('nightly_cleanup', '{"recurring": true}');
select test.assert((select count(*) from public.jobs where type = 'nightly_cleanup') = 2,
  'recurring jobs: the next run can be queued once the previous one finished');

-- ---------- team profiles ----------
insert into public.profiles (role, full_name, email) values ('staff', 'Nadia Noauth', 'nadia@test.local');
select test.assert(
  (select id is not null and not must_change_password and failed_login_attempts = 0
   from public.profiles where email = 'nadia@test.local'),
  'a profile gets its own id');

do $$
begin
  insert into public.profiles (role, email) values ('viewer', 'NADIA@test.local');
  raise exception 'FAIL: two team profiles share an email';
exception when unique_violation then
  raise notice 'PASS: a team email belongs to one profile, in any case';
end;
$$;

-- ---------- sign-in secrets stay away from the public key ----------
update public.profiles set password_hash = 'scrypt-hash-for-test', phone = '+201000000001'
where id = '00000000-0000-0000-0000-0000000000a1';

do $$
begin
  set local role anon;
  perform 1 from public.profiles;
  raise exception 'FAIL: a visitor could read profiles';
exception when insufficient_privilege then
  raise notice 'PASS: a visitor cannot read profiles';
end;
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
  perform password_hash from public.profiles;
  raise exception 'FAIL: staff could read password hashes';
exception when insufficient_privilege then
  raise notice 'PASS: staff cannot read password hashes with the public key';
end;
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
  perform failed_login_attempts, locked_until from public.profiles;
  raise exception 'FAIL: a patient could read lockout counters';
exception when insufficient_privilege then
  raise notice 'PASS: lockout counters are hidden from logged-in users';
end;
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
  update public.profiles set must_change_password = false where id = '00000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL: a logged-in user changed their own sign-in state';
exception when insufficient_privilege then
  raise notice 'PASS: logged-in users cannot change their own sign-in state';
end;
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
  perform code_ciphertext from public.patients;
  raise exception 'FAIL: staff could read code ciphertexts';
exception when insufficient_privilege then
  raise notice 'PASS: personal-code ciphertexts are hidden from the public key';
end;
$$;

-- ---------- encrypted personal codes ----------
do $$
begin
  update public.patients set code_ciphertext = 'cipher-for-test' where email = 'paul@example.com';
  raise exception 'FAIL: a ciphertext was saved without its key id';
exception when check_violation then
  raise notice 'PASS: a ciphertext can''t be saved without its key id';
end;
$$;

update public.patients set code_ciphertext = 'cipher-for-test', code_key_id = 'k1', code_issued_at = now()
where email = 'paul@example.com';
select test.assert((select code_key_id = 'k1' from public.patients where email = 'paul@example.com'),
  'a ciphertext is saved together with its key id');

-- ---------- sessions and emailed codes ----------
select test.assert(
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.auth_sessions'::regclass, 'public.login_codes'::regclass))
  and not exists (select 1 from pg_policies where tablename in ('auth_sessions', 'login_codes')),
  'sessions and login codes have RLS on and no policies');

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.auth_sessions (profile_id, refresh_hash, method, expires_at)
select id, 'hash-for-test', 'password', now() + interval '12 hours'
from public.profiles where email = 'nadia@test.local' and role = 'staff';
insert into public.login_codes (purpose, email, code_hmac, payload, expires_at)
values ('sign_up', 'New@Example.com', 'hmac-for-test', '{"full_name":"New Person"}', now() + interval '10 minutes');
insert into public.login_codes (purpose, email, code_hmac, expires_at)
values ('sign_in', 'new@example.com', 'hmac-for-test', now() + interval '10 minutes');
select test.assert(
  (select count(*) from public.auth_sessions) = 1 and (select count(*) from public.login_codes) = 2,
  'the server key can use sessions and login codes');
commit;

do $$
begin
  insert into public.login_codes (purpose, email, code_hmac, expires_at)
  values ('sign_up', 'NEW@example.com', 'another', now() + interval '10 minutes');
  raise exception 'FAIL: two live codes for one purpose and email';
exception when unique_violation then
  raise notice 'PASS: one live code per purpose and email, in any case';
end;
$$;

do $$
begin
  insert into public.auth_sessions (profile_id, refresh_hash, method, expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', 'x', 'magic', now());
  raise exception 'FAIL: an unknown sign-in method was accepted';
exception when check_violation then
  raise notice 'PASS: a session must name a known sign-in method';
end;
$$;

delete from public.profiles where email = 'nadia@test.local' and role = 'staff';
select test.assert((select count(*) from public.auth_sessions) = 0, 'removing a profile removes its sessions');

-- A fresh row, so the loop below would notice a leak instead of reading an empty table.
insert into public.auth_sessions (profile_id, refresh_hash, method, expires_at)
values ('00000000-0000-0000-0000-0000000000a1', 'hash-for-test', 'password', now() + interval '12 hours');

do $$
declare
  v_role  text;
  v_table text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_table in array array['auth_sessions', 'login_codes', 'v_patients_masked', 'v_profiles_masked',
                                   'v_appointments_masked', 'v_messages_masked', 'v_notifications_masked', 'v_audit_log_masked'] loop
      begin
        execute format('set local role %I', v_role);
        execute format('select 1 from public.%I limit 1', v_table);
        raise exception 'FAIL: % could read %', v_role, v_table;
      exception when insufficient_privilege then
        raise notice 'PASS: % cannot read %', v_role, v_table;
      end;
    end loop;
  end loop;
end;
$$;

do $$
begin
  set local role authenticated;
  insert into public.auth_sessions (profile_id, refresh_hash, method, expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', 'x', 'password', now());
  raise exception 'FAIL: the public key could create a session';
exception when insufficient_privilege then
  raise notice 'PASS: the public key cannot create a session';
end;
$$;

-- ---------- views and masked twins ----------
insert into public.conversations (id, assistant) values ('00000000-0000-0000-0000-00000000d101', 'patient');
insert into public.messages (conversation_id, role, content, tool_name, tool_payload)
values ('00000000-0000-0000-0000-00000000d101', 'user', 'Mail paul@example.com', 'lookup', '{"phone":"+201112223334"}');
insert into public.notifications (template, to_address) values ('email_code', 'paul@example.com');
insert into public.agent_runs (assistant, outcome) values ('patient', 'answered');
insert into public.agent_runs (assistant, outcome, created_at) values ('patient', 'refused', now() - interval '10 days');
update public.patients set notes = 'Call 01001234567' where email = 'paul@example.com';
select public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('16:00', 6),
  'Paul Patient', '1990-01-01', p_email => 'paul@example.com', p_notes => 'Call 01001234567');

do $$
declare
  v_view  text;
  v_count bigint;
begin
  set local role service_role;
  set local request.jwt.claims = '{"role":"service_role"}';
  foreach v_view in array array['v_patients', 'v_profiles', 'v_appointments', 'v_messages', 'v_notifications',
                                'v_audit_log', 'v_stats_today', 'v_stats_upcoming_by_doctor', 'v_ai_outcomes_7d'] loop
    execute format('select count(*) from public.%I', v_view) into v_count;
    perform test.assert(v_count > 0, format('the server key gets rows from %s', v_view));
  end loop;
end;
$$;

do $$
declare
  v_view text;
begin
  foreach v_view in array array['v_patients', 'v_profiles', 'v_appointments', 'v_messages', 'v_notifications',
                                'v_audit_log', 'v_stats_today', 'v_stats_upcoming_by_doctor', 'v_ai_outcomes_7d'] loop
    begin
      set local role authenticated;
      execute format('select count(*) from public.%I', v_view);
      raise exception 'FAIL: the public key could read %', v_view;
    exception when insufficient_privilege then
      raise notice 'PASS: the public key cannot read %', v_view;
    end;
  end loop;
end;
$$;


begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select test.assert(
  (select full_name = 'Paul Patient' and email = 'paul@example.com' and phone = '+201112223334' and date_of_birth = '1990-01-01'
   from public.v_patients where email = 'paul@example.com'),
  'the server key sees real details in v_patients');
select test.assert(not exists (select 1 from public.v_ai_outcomes_7d where outcome = 'refused'),
  'v_ai_outcomes_7d still covers only the last 7 days for the server key');
select test.assert(
  (select content = 'Mail paul@example.com' and tool_payload is not null
   from public.v_messages where conversation_id = '00000000-0000-0000-0000-00000000d101'),
  'the server key sees real messages in v_messages');
select test.assert(
  (select must_change_password = false and disabled_at is null and last_sign_in_at is null
   from public.v_profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'v_profiles shows the sign-in state');

select test.assert(
  (select full_name = 'Paul P.' and email = 'p***@example.com' and phone = '+2011******34'
     and date_of_birth is null and notes = 'Call [phone hidden]'
   from public.v_patients_masked where id = (select id from public.patients where email = 'paul@example.com')),
  'v_patients_masked hides the name, email, phone, date of birth and notes');
select test.assert(
  (select full_name = 'Olivia O.' and email = 'o***@test.local' and phone = '+2010******01'
   from public.v_profiles_masked where id = '00000000-0000-0000-0000-0000000000a1'),
  'v_profiles_masked hides the name, email and phone');
select test.assert(
  (select patient_name = 'Paul P.' and notes = 'Call [phone hidden]'
   from public.v_appointments_masked where starts_at = test.at('16:00', 6)),
  'v_appointments_masked hides the patient name and notes');
select test.assert(
  (select content = 'Mail p***@example.com' and tool_payload is null
   from public.v_messages_masked where conversation_id = '00000000-0000-0000-0000-00000000d101'),
  'v_messages_masked hides contact details and tool data');
select test.assert(
  (select bool_and(to_address = 'p***@example.com') from public.v_notifications_masked),
  'v_notifications_masked hides the address');
select test.assert(
  exists (select 1 from public.v_audit_log where after ->> 'notes' = 'Call 01001234567')
  and not exists (select 1 from public.v_audit_log_masked
                  where before ? 'notes' or after ? 'notes' or before ? 'cancel_reason' or after ? 'cancel_reason'),
  'v_audit_log_masked leaves out notes and cancel reasons');
commit;

select test.assert(
  not exists (
    select 1
    from unnest(array['v_patients', 'v_profiles', 'v_appointments', 'v_messages', 'v_notifications', 'v_audit_log']) as plain(name)
    where (select array_agg(attname || ' ' || format_type(atttypid, atttypmod) order by attnum)
           from pg_attribute where attrelid = ('public.' || name)::regclass and attnum > 0)
      is distinct from
          (select array_agg(attname || ' ' || format_type(atttypid, atttypmod) order by attnum)
           from pg_attribute where attrelid = ('public.' || name || '_masked')::regclass and attnum > 0)
  ),
  'every masked twin has exactly the columns of its plain view');

-- ---------- cancel and reschedule with the server key ----------
-- f101, f102: Paul's, hours away, so inside the 24 h window.
-- f103: Rana's, holding day 6 at 11:00. f104: Paul's with another doctor at 14:00.
insert into public.appointments (id, patient_id, staff_id, service_id, starts_at, source)
select b.id, p.id, b.staff_id, '00000000-0000-0000-0000-0000000000c1', b.starts_at, 'website'
from (values
  ('00000000-0000-0000-0000-00000000f101'::uuid, 'paul@example.com', '00000000-0000-0000-0000-0000000000b1'::uuid, date_trunc('minute', now()) + interval '5 hours'),
  ('00000000-0000-0000-0000-00000000f102'::uuid, 'paul@example.com', '00000000-0000-0000-0000-0000000000b1'::uuid, date_trunc('minute', now()) + interval '7 hours'),
  ('00000000-0000-0000-0000-00000000f103'::uuid, 'rana@example.com', '00000000-0000-0000-0000-0000000000b1'::uuid, test.at('11:00', 6)),
  ('00000000-0000-0000-0000-00000000f104'::uuid, 'paul@example.com', '00000000-0000-0000-0000-0000000000b9'::uuid, test.at('14:00', 6))
) as b(id, email, staff_id, starts_at)
join public.patients p on p.email = b.email;

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.headers = '{"x-actor-id":"00000000-0000-0000-0000-0000000000a2","x-change-via":"dashboard"}';
select test.assert(
  public.cancel_appointment('00000000-0000-0000-0000-00000000f101', 'test') ->> 'ok' = 'true',
  'cancelling works inside the 24 h window: that rule is the backend''s now');
select test.assert(
  public.cancel_appointment('00000000-0000-0000-0000-00000000f101') ->> 'error' = 'not_cancellable',
  'the status check still applies to the server key');
select test.assert(
  public.cancel_appointment('00000000-0000-0000-0000-0000000000ff') ->> 'error' = 'not_found',
  'cancelling an unknown booking is still not_found');

select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-00000000f102', test.at('12:00', 6)) ->> 'ok' = 'true',
  'rescheduling works inside the 24 h window: that rule is the backend''s now');
select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-00000000f102', test.at('11:00', 6)) ->> 'error' = 'slot_taken',
  'reschedule with the server key: a booked time is still slot_taken');
select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-00000000f102', test.at('14:00', 6)) ->> 'error' = 'patient_has_overlap',
  'reschedule with the server key: a clash for the patient is still refused');
select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-00000000f102', test.at('03:00', 6)) ->> 'error' = 'slot_unavailable',
  'reschedule with the server key: outside working hours is still slot_unavailable');
select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-00000000f101', test.at('13:00', 6)) ->> 'error' = 'not_cancellable',
  'reschedule with the server key: a cancelled booking stays cancelled');
select test.assert(
  public.reschedule_appointment('00000000-0000-0000-0000-0000000000ff', test.at('13:00', 6)) ->> 'error' = 'not_found',
  'reschedule with the server key: an unknown booking is not_found');
commit;

select test.assert(
  (select actor_id = '00000000-0000-0000-0000-0000000000a2' and via = 'dashboard' and after ->> 'status' = 'cancelled'
   from public.audit_log where entity_id = '00000000-0000-0000-0000-00000000f101' order by id desc limit 1),
  'a cancellation with the server key is audited for the user in the headers');

-- ---------- owner schedule edits with the server key ----------
begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.headers = '{"x-actor-id":"00000000-0000-0000-0000-0000000000a1","x-change-via":"dashboard"}';
select test.assert(
  public.set_working_hours('00000000-0000-0000-0000-0000000000b9',
    '[{"weekday":3,"start_time":"09:00","end_time":"12:00"}]') ->> 'count' = '1',
  'the server key can replace a doctor''s weekly schedule');
select test.assert(
  public.set_staff_services('00000000-0000-0000-0000-0000000000b9',
    array['00000000-0000-0000-0000-0000000000c1']::uuid[]) ->> 'count' = '1',
  'the server key can replace the services a doctor offers');
commit;

select test.assert(
  (select actor_id = '00000000-0000-0000-0000-0000000000a1' and via = 'dashboard'
   from public.audit_log where entity = 'working_hours' order by id desc limit 1),
  'a schedule change with the server key is audited for the owner in the headers');
select test.assert(
  (select actor_id = '00000000-0000-0000-0000-0000000000a1' and via = 'dashboard'
   from public.audit_log where entity = 'staff_services' order by id desc limit 1),
  'a services change with the server key is audited for the owner in the headers');

-- ---------- reminders with no placeholder domain ----------
select test.assert(public.queue_due_reminders(null) = 1,
  'reminders: with no domain to skip, the one remaining booking with an email is due');
select test.assert(
  (select reminder_sent_at is not null from public.appointments where id = '00000000-0000-0000-0000-00000000f004'),
  'reminders: the address a domain used to skip gets its reminder');

update public.appointments set reminder_sent_at = null where id = '00000000-0000-0000-0000-00000000f004';
select test.assert(public.queue_due_reminders() = 1, 'reminders: the domain can be left out altogether');

-- ---------- the database only stores data ----------
select test.assert(not exists (select 1 from pg_policies where schemaname = 'public'), 'no policies are left');
select test.assert(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'Row Level Security is on for every table, so a key without the service role gets nothing');
select test.assert(
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'the public keys have no rights on any table or view');
select test.assert(
  not exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'the public keys can call no function');
select test.assert(
  not has_schema_privilege('anon', 'public', 'usage') and not has_schema_privilege('authenticated', 'public', 'usage'),
  'the public keys cannot even enter the schema');

create table public.test_new_table (id integer);
create function public.test_new_function() returns integer language sql as 'select 1';
select test.assert(
  not has_table_privilege('anon', 'public.test_new_table', 'select')
  and not has_table_privilege('authenticated', 'public.test_new_table', 'select')
  and not has_function_privilege('anon', 'public.test_new_function()', 'execute')
  and not has_function_privilege('authenticated', 'public.test_new_function()', 'execute'),
  'a future table or function starts with no rights for the public keys');
drop table public.test_new_table;
drop function public.test_new_function();

select test.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('current_user_role', 'is_staff', 'is_owner', 'can_view_all',
                'handle_new_user', 'handle_deleted_user', 'verify_patient_by_phone', 'find_patient_by_code', 'normalize_person_name')),
  'the role helpers and the old sign-in functions are gone');
select test.assert(
  not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal),
  'nothing listens to Supabase Auth logins any more');
select test.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
      and pg_get_functiondef(p.oid) ~ 'auth\.(uid|jwt|role)'),
  'no function reads a Supabase Auth user');
select test.assert(
  not exists (select 1 from pg_views where schemaname = 'public' and definition ~ 'auth\.'),
  'no view reads a Supabase Auth user');

do $$
begin
  set local role service_role;
  perform public.book_appointment('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.at('17:00', 6),
    'Server Booking', '1990-01-01', p_email => 'server@example.com');
  perform 1 from public.patients;
  perform 1 from public.auth_sessions;
  perform public.get_available_slots('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', test.day());
  raise notice 'PASS: the server key can still do its work';
end;
$$;
