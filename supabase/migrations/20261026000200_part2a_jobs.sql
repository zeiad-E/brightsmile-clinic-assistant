-- Part 2a, step 5: appointment reminders, the waitlist and chat retention, run as background jobs.

-- ---------- reminders ----------

-- A moved booking needs a fresh reminder for its new time.
create function public.reset_reminder_on_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;

create trigger appointments_reset_reminder before update of starts_at on public.appointments
  for each row execute function public.reset_reminder_on_move();

-- Reminder bookkeeping is not a clinic change: leave it out of the audit log
-- (an update that only touches reminder_sent_at then records nothing).
drop trigger audit_appointments on public.appointments;
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_row_change('reminder_sent_at');

-- Finds bookings due a reminder, marks them and queues one send_reminder job each, in ONE
-- transaction: a booking can never get two reminders, and none is lost between the steps.
--
-- Due = starts between 2 h and (online change window + 24 h) from now, so the patient
-- normally still has about a day to change it online. Bookings made in the last 12 h are
-- skipped: their confirmation email is recent enough.
create function public.queue_due_reminders(p_skip_email_domain text, p_limit integer default 100)
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
      and lower(p.email) not like '%@' || lower(p_skip_email_domain)
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

-- ---------- chat retention ----------

-- Deletes chats older than clinic_settings.chat_retention_days (messages go with them),
-- except chats with an open escalation: staff still need those. Works in batches.
create function public.purge_expired_conversations(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  integer;
  v_count integer;
begin
  select chat_retention_days into v_days from public.clinic_settings where id = 1;

  with expired as (
    select c.id
    from public.conversations c
    where c.last_message_at < now() - make_interval(days => coalesce(v_days, 90))
      and not exists (
        select 1 from public.escalations e where e.conversation_id = c.id and e.status = 'open'
      )
    order by c.last_message_at
    limit p_limit
  )
  delete from public.conversations c using expired where c.id = expired.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create index conversations_last_message_idx on public.conversations (last_message_at);

-- ---------- waitlist ----------
create index waitlist_patient_idx on public.waitlist (patient_id, status);

-- ---------- recurring jobs ----------
-- At most one waiting (or running) copy of each recurring job, so restarts and the hourly
-- safety check can "make sure it is scheduled" without ever piling up duplicates.
create unique index jobs_one_recurring_idx on public.jobs (type)
  where status in ('queued', 'running') and payload ? 'recurring';

revoke execute on function public.queue_due_reminders(text, integer) from public, anon, authenticated;
revoke execute on function public.purge_expired_conversations(integer) from public, anon, authenticated;
grant execute on function public.queue_due_reminders(text, integer) to service_role;
grant execute on function public.purge_expired_conversations(integer) to service_role;
