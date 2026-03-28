create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'user' check (role in ('user', 'admin', 'super_admin')),
  billing_plan text not null default 'free' check (billing_plan in ('free', 'pro', 'enterprise')),
  subscription_status text not null default 'inactive',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists billing_plan text not null default 'free';
alter table public.profiles add column if not exists subscription_status text not null default 'inactive';
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_price_id text;
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.profiles add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  path text not null default '',
  status text not null default 'draft',
  live_url text,
  deployment_provider text,
  repository_url text,
  custom_domain text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.projects add column if not exists path text not null default '';
alter table public.projects add column if not exists status text not null default 'draft';
alter table public.projects add column if not exists live_url text;
alter table public.projects add column if not exists deployment_provider text;
alter table public.projects add column if not exists repository_url text;
alter table public.projects add column if not exists custom_domain text;
alter table public.projects add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.projects add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin', 'super_admin')),
  session_token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  user_agent text,
  ip_address text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_projects_user_id_updated_at
  on public.projects (user_id, updated_at desc);

create index if not exists idx_app_sessions_user_id
  on public.app_sessions (user_id);

create index if not exists idx_app_sessions_expires_at
  on public.app_sessions (expires_at);

create index if not exists idx_billing_events_user_id
  on public.billing_events (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

drop trigger if exists app_sessions_set_updated_at on public.app_sessions;
create trigger app_sessions_set_updated_at
before update on public.app_sessions
for each row
execute function public.set_updated_at();

create or replace function public.resolve_auth_role(raw_app_meta jsonb, raw_user_meta jsonb)
returns text
language sql
stable
as $$
  select case
    when coalesce(raw_app_meta ->> 'role', raw_user_meta ->> 'role', 'user') in ('user', 'admin', 'super_admin')
      then coalesce(raw_app_meta ->> 'role', raw_user_meta ->> 'role', 'user')
    else 'user'
  end;
$$;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_role text;
begin
  resolved_role := public.resolve_auth_role(new.raw_app_meta_data, new.raw_user_meta_data);

  insert into public.profiles (
    user_id,
    email,
    role
  )
  values (
    new.id,
    coalesce(new.email, ''),
    resolved_role
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    role = excluded.role,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.sync_profile_from_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_app_meta_data, raw_user_meta_data on auth.users
for each row
execute function public.sync_profile_from_auth_user();

create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    'user'
  );
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.app_sessions enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
);

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin
on public.profiles
for update
to authenticated
using (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
)
with check (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
);

drop policy if exists projects_select_own_or_admin on public.projects;
create policy projects_select_own_or_admin
on public.projects
for select
to authenticated
using (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
);

drop policy if exists projects_insert_own_or_admin on public.projects;
create policy projects_insert_own_or_admin
on public.projects
for insert
to authenticated
with check (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
);

drop policy if exists projects_update_own_or_admin on public.projects;
create policy projects_update_own_or_admin
on public.projects
for update
to authenticated
using (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
)
with check (
  auth.uid() = user_id or public.jwt_role() in ('admin', 'super_admin')
);

drop policy if exists billing_events_admin_only on public.billing_events;
create policy billing_events_admin_only
on public.billing_events
for select
to authenticated
using (
  public.jwt_role() in ('admin', 'super_admin')
);
