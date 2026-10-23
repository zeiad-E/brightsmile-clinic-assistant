-- Clinic setup: settings, services, who offers what, schedules, time off.

-- Single-row settings table.
create table public.clinic_settings (
  id                        smallint primary key default 1 check (id = 1),
  name_en                   text not null,
  name_ar                   text not null,
  timezone                  text not null default 'Africa/Cairo',
  phone                     text,
  email                     text,
  address_en                text,
  address_ar                text,
  currency                  text not null default 'EGP',
  slot_step_minutes         integer not null default 15 check (slot_step_minutes between 5 and 60),
  min_lead_minutes          integer not null default 120 check (min_lead_minutes >= 0),
  booking_horizon_days      integer not null default 30 check (booking_horizon_days between 1 and 365),
  cancellation_window_hours integer not null default 24 check (cancellation_window_hours >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger clinic_settings_set_updated_at
  before update on public.clinic_settings
  for each row execute function public.set_updated_at();

create table public.services (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en          text not null,
  name_ar          text not null,
  description_en   text,
  description_ar   text,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 480 and duration_minutes % 5 = 0),
  price_egp        numeric(10, 2) not null check (price_egp >= 0),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- Which doctor offers which service.
create table public.staff_services (
  staff_id   uuid not null references public.staff (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, service_id)
);

create index staff_services_service_idx on public.staff_services (service_id);

-- Weekly schedule (0 = Sunday … 6 = Saturday). Several shifts per day are allowed,
-- but shifts of the same doctor on the same day can't overlap.
create table public.working_hours (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint working_hours_valid_range check (end_time > start_time),
  constraint working_hours_no_overlap exclude using gist (
    staff_id with =,
    weekday with =,
    tsrange(date '2000-01-01' + start_time, date '2000-01-01' + end_time) with &&
  )
);

create trigger working_hours_set_updated_at
  before update on public.working_hours
  for each row execute function public.set_updated_at();

-- Exceptions: a doctor's vacation, or the whole clinic closed (staff_id null).
create table public.time_off (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references public.staff (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_valid_range check (ends_at > starts_at)
);

create index time_off_staff_starts_idx on public.time_off (staff_id, starts_at);

create trigger time_off_set_updated_at
  before update on public.time_off
  for each row execute function public.set_updated_at();
