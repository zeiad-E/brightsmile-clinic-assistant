-- Extensions and enum types.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;      -- embeddings (RAG)
create extension if not exists btree_gist with schema extensions;  -- exclusion constraints on uuid + ranges
create extension if not exists citext with schema extensions;      -- case-insensitive email

create type public.user_role as enum ('patient', 'staff', 'owner', 'viewer');
create type public.lang as enum ('en', 'ar');
create type public.staff_title as enum ('dentist', 'hygienist');
create type public.appointment_status as enum ('booked', 'cancelled', 'completed', 'no_show');
create type public.booking_source as enum ('patient_assistant', 'staff_assistant', 'dashboard');
create type public.urgency as enum ('low', 'normal', 'high', 'urgent');
create type public.escalation_status as enum ('open', 'resolved');
create type public.notification_status as enum ('queued', 'sent', 'failed');
create type public.assistant_kind as enum ('patient', 'staff');
create type public.message_role as enum ('user', 'assistant', 'tool');
create type public.run_outcome as enum ('answered', 'booked', 'changed_data', 'escalated', 'refused', 'fallback', 'error');
create type public.ingest_status as enum ('pending', 'processing', 'ready', 'failed');
