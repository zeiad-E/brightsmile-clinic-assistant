-- Live checks for migration 20261026000200 (reminders, chat retention, recurring jobs).
--
-- Safe to run on the LIVE project (Supabase dashboard → SQL Editor): everything happens in one
-- block that ends by raising an error on purpose, and an error undoes the whole block. No test
-- row stays behind. The results are in that final error message: every line should say PASS.

do $$
declare
  v_service uuid := (select id from public.services order by created_at limit 1);
  v_staff   uuid := gen_random_uuid();
  v_p_email uuid := gen_random_uuid();
  v_p_inner uuid := gen_random_uuid();
  v_due     uuid := gen_random_uuid();
  v_far     uuid := gen_random_uuid();
  v_soon    uuid := gen_random_uuid();
  v_inner   uuid := gen_random_uuid();
  v_recent  uuid := gen_random_uuid();
  v_old     uuid := gen_random_uuid();
  v_held    uuid := gen_random_uuid();
  v_fresh   uuid := gen_random_uuid();
  v_out     text[] := '{}';

  v_ok boolean;
begin
  insert into public.staff (id, full_name_en, full_name_ar, title) values (v_staff, 'Live Check Doctor', 'طبيب اختبار', 'dentist');
  insert into public.patients (id, full_name, date_of_birth, email) values
    (v_p_email, 'Live Check Patient', '1990-01-01', 'live-check-' || v_p_email || '@example.com'),
    (v_p_inner, 'Live Check Phone Only', '1990-01-01', 'live-check-' || v_p_inner || '@patients.brightsmile.app');

  insert into public.appointments (id, patient_id, staff_id, service_id, starts_at, source, created_at) values
    (v_due,    v_p_email, v_staff, v_service, now() + interval '30 hours', 'website', now() - interval '2 days'),
    (v_far,    v_p_email, v_staff, v_service, now() + interval '60 hours', 'website', now() - interval '2 days'),
    (v_soon,   v_p_email, v_staff, v_service, now() + interval '1 hour',   'website', now() - interval '2 days'),
    (v_inner,  v_p_inner, v_staff, v_service, now() + interval '36 hours', 'website', now() - interval '2 days'),
    (v_recent, v_p_email, v_staff, v_service, now() + interval '40 hours', 'website', now());

  perform public.queue_due_reminders('patients.brightsmile.app');

  v_ok := (select reminder_sent_at is not null from public.appointments where id = v_due)
    and exists (select 1 from public.jobs where type = 'send_reminder' and payload ->> 'appointment_id' = v_due::text);
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': a booking 30 h away gets one reminder job');

  v_ok := (select count(*) from public.appointments where id in (v_far, v_soon, v_inner, v_recent) and reminder_sent_at is not null) = 0;
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': too far, too soon, internal address and just-booked are skipped');

  perform public.queue_due_reminders('patients.brightsmile.app');
  v_ok := (select count(*) from public.jobs where type = 'send_reminder' and payload ->> 'appointment_id' = v_due::text) = 1;
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': a second sweep does not queue it again');

  v_ok := not exists (select 1 from public.audit_log where entity_id = v_due::text and action = 'appointments.update');
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': the reminder mark is not written to the audit log');

  update public.appointments set starts_at = starts_at + interval '1 hour' where id = v_due;
  v_ok := (select reminder_sent_at is null from public.appointments where id = v_due);
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': moving a booking clears its reminder mark');

  -- Retention (uses the clinic's real chat_retention_days).
  insert into public.conversations (id, assistant, last_message_at) values
    (v_old,   'patient', now() - interval '4000 days'),
    (v_held,  'patient', now() - interval '4000 days'),
    (v_fresh, 'patient', now());
  insert into public.escalations (conversation_id, reason) values (v_held, 'live check');

  perform public.purge_expired_conversations(100000);
  v_ok := not exists (select 1 from public.conversations where id = v_old)
    and exists (select 1 from public.conversations where id = v_held)
    and exists (select 1 from public.conversations where id = v_fresh);
  v_out := v_out || (case when v_ok then 'PASS' else 'FAIL' end || ': old chats go; open escalations and recent chats stay');

  -- Recurring jobs: one waiting copy per type.
  insert into public.jobs (type, payload) values ('live_check_recurring', '{"recurring": true}');
  begin
    insert into public.jobs (type, payload) values ('live_check_recurring', '{"recurring": true}');
    v_out := v_out || 'FAIL: a second waiting copy of a recurring job was accepted'::text;
  exception when unique_violation then
    v_out := v_out || 'PASS: a recurring job has at most one waiting copy'::text;
  end;

  raise exception E'LIVE CHECKS (all changes undone):\n%', array_to_string(v_out, E'\n');
end;
$$;
