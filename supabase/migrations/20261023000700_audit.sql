-- Audit log: record every change to clinic data with before/after values.
--
-- Actor: the signed-in user (auth.uid()). When the backend writes with the service
-- role on someone's behalf, it sends the `x-actor-id` header (trusted only for the
-- service role). Channel comes from the `x-change-via` header.
-- Trigger arguments = columns to leave out of the snapshots (e.g. large text).

create function public.audit_row_change()
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

create trigger audit_clinic_settings after insert or update or delete on public.clinic_settings
  for each row execute function public.audit_row_change();
create trigger audit_services after insert or update or delete on public.services
  for each row execute function public.audit_row_change();
create trigger audit_staff after insert or update or delete on public.staff
  for each row execute function public.audit_row_change();
create trigger audit_staff_services after insert or update or delete on public.staff_services
  for each row execute function public.audit_row_change();
create trigger audit_working_hours after insert or update or delete on public.working_hours
  for each row execute function public.audit_row_change();
create trigger audit_time_off after insert or update or delete on public.time_off
  for each row execute function public.audit_row_change();
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_row_change();
create trigger audit_knowledge_docs after insert or update or delete on public.knowledge_docs
  for each row execute function public.audit_row_change('content');
