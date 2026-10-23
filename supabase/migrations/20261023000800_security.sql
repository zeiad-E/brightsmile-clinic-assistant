-- Row Level Security and privileges.
--
-- Roles: anon (visitor), authenticated (patient / staff / owner / viewer via profiles.role),
-- service_role (backend, bypasses RLS). The viewer role is read-only: no write policy
-- includes it. Viewer access to personal data goes through the masked views (next migration).

alter table public.profiles         enable row level security;
alter table public.patients         enable row level security;
alter table public.staff            enable row level security;
alter table public.clinic_settings  enable row level security;
alter table public.services         enable row level security;
alter table public.staff_services   enable row level security;
alter table public.working_hours    enable row level security;
alter table public.time_off         enable row level security;
alter table public.appointments     enable row level security;
alter table public.escalations      enable row level security;
alter table public.notifications    enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;
alter table public.agent_runs       enable row level security;
alter table public.audit_log        enable row level security;
alter table public.knowledge_docs   enable row level security;
alter table public.knowledge_chunks enable row level security;  -- no policies: backend only

-- profiles: own row; staff/owner see all. Users can edit only a few of their own columns.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (full_name, phone, preferred_language) on public.profiles to authenticated;

-- patients: own record; staff/owner read and edit (booking/sign-in go through functions).
create policy patients_select on public.patients for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_staff()));
create policy patients_update_staff on public.patients for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Public catalog: doctors, services, who-offers-what, schedules, settings.
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

-- Time off: staff manage it; viewer can look.
create policy time_off_select on public.time_off for select to authenticated
  using ((select public.can_view_all()));
create policy time_off_write on public.time_off for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Appointments: patients see their own; staff/owner/viewer see all; staff/owner edit
-- (creation and patient cancellation go through book_appointment / cancel_appointment).
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

-- Escalations: staff work them; viewer can look.
create policy escalations_select on public.escalations for select to authenticated
  using ((select public.can_view_all()));
create policy escalations_update_staff on public.escalations for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Notifications: owner (viewer sees the masked view).
create policy notifications_select on public.notifications for select to authenticated
  using ((select public.is_owner()));

-- Conversations: your own; staff/owner/viewer see all.
create policy conversations_select on public.conversations for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.can_view_all()));

-- Messages: of your own conversations; staff/owner see all (viewer: masked view).
create policy messages_select on public.messages for select to authenticated
  using (
    (select public.is_staff())
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.profile_id = (select auth.uid())
    )
  );

-- Agent stats: owner and viewer (no personal data in this table).
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (public.current_user_role() in ('owner', 'viewer'));

-- Audit log: owner (viewer sees the masked view).
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_owner()));

-- Knowledge docs: published ones are public; owner manages them.
create policy knowledge_docs_select on public.knowledge_docs for select to anon, authenticated
  using ((is_published and ingest_status = 'ready') or (select public.can_view_all()));
create policy knowledge_docs_write on public.knowledge_docs for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Function privileges. Supabase grants EXECUTE to anon/authenticated by default, so
-- revoke first, then grant only what each role needs.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Needed inside security policies.
grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.is_staff()           to anon, authenticated;
grant execute on function public.is_owner()           to anon, authenticated;
grant execute on function public.can_view_all()       to anon, authenticated;

-- Anyone may look up free slots (no personal data returned).
grant execute on function public.get_available_slots(uuid, uuid, date, boolean) to anon, authenticated;

-- Signed-in users cancel as themselves (rules enforced inside).
grant execute on function public.cancel_appointment(uuid, text, uuid) to authenticated;

-- Server only (the backend verifies identity / rate-limits before calling).
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, date, text, text, public.lang, public.booking_source, text, uuid, text) to service_role;
grant execute on function public.cancel_appointment(uuid, text, uuid) to service_role;
grant execute on function public.verify_patient_by_phone(text, text, date) to service_role;
grant execute on function public.find_patient_by_code(text) to service_role;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, public.lang, double precision) to service_role;

-- Pure helpers (no data access).
grant execute on function public.normalize_person_name(text) to anon, authenticated, service_role;
grant execute on function public.mask_email(text) to authenticated, service_role;
grant execute on function public.mask_phone(text) to authenticated, service_role;
grant execute on function public.mask_text(text) to authenticated, service_role;
