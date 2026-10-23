-- People: logins (profiles), patients, staff, and role helpers.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- One row per login (auth.users), created by trigger on sign-up.
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  role               public.user_role not null default 'patient',
  full_name          text,
  email              extensions.citext,
  phone              text,
  preferred_language public.lang not null default 'en',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Doctors and hygienists. Patients choose one when booking.
create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid unique references public.profiles (id) on delete set null,
  full_name_en text not null,
  full_name_ar text not null,
  title        public.staff_title not null,
  bio_en       text,
  bio_ar       text,
  photo_url    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

-- Every patient. A booking finds the patient by email/phone or creates one; the
-- backend links the login (profile_id) right after, through the Supabase Auth API.
create table public.patients (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid unique references public.profiles (id) on delete set null,
  full_name             text not null check (btrim(full_name) <> ''),
  date_of_birth         date not null check (date_of_birth between date '1900-01-01' and date '2100-01-01'),
  email                 extensions.citext unique,
  phone                 text unique check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  code_hmac             text unique,
  login_failed_attempts integer not null default 0 check (login_failed_attempts >= 0),
  login_locked_until    timestamptz,
  preferred_language    public.lang not null default 'en',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint patients_contact_required check (email is not null or phone is not null)
);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- Create the profile for every new login. Role comes from app_metadata, which only
-- the server (service role) can set — users can never choose their own role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email, phone, preferred_language)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.phone,
    coalesce((new.raw_user_meta_data ->> 'preferred_language')::public.lang, 'en')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by security policies (security definer avoids policy recursion).
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('staff', 'owner'), false);
$$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'owner', false);
$$;

-- Staff, owner and the read-only viewer (client demo) can see clinic-wide data.
create function public.can_view_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('staff', 'owner', 'viewer'), false);
$$;
