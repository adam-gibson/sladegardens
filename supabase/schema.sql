-- Slade Gardens Adventure Playground – Staff Timesheets
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- FIRST: change the admin email at the bottom of this file. Then run 002_entry_approval.sql.

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  forename text not null default '',
  surname text not null default '',
  phone text not null default '',
  role text not null default 'staff' check (role in ('staff', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive')),
  created_at timestamptz not null default now()
);

-- Staff added in advance by the admin. Used (then removed) on that person's first login.
create table if not exists public.staff_invites (
  email text primary key,
  forename text not null,
  surname text not null,
  phone text not null default '',
  role text not null default 'staff' check (role in ('staff', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.entries (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  break_mins int not null default 0 check (break_mins between 0 and 600),
  hours numeric(5, 2) not null default 0,
  activity text not null check (length(activity) between 1 and 60),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entries_user_date on public.entries (user_id, work_date);
create index if not exists entries_date on public.entries (work_date);

-- ---------- helper functions ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

-- New login → create profile (active if the admin invited them, otherwise pending approval)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv staff_invites;
begin
  select * into inv from staff_invites where lower(email) = lower(new.email);
  if found then
    insert into profiles (id, email, forename, surname, phone, role, status)
    values (new.id, lower(new.email), inv.forename, inv.surname, inv.phone, inv.role, 'active');
    delete from staff_invites where email = inv.email;
  else
    insert into profiles (id, email) values (new.id, lower(new.email));
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Staff may edit their own name/phone, but only admins may change email, role or status
create or replace function public.protect_profile() returns trigger
language plpgsql set search_path = public as $$
begin
  -- auth.uid() is null when changed directly in the Supabase SQL Editor, which is trusted
  if auth.uid() is not null and not is_admin() then
    new.role := old.role; new.status := old.status; new.email := old.email;
  end if;
  if new.id = auth.uid() and old.role = 'admin' and (new.role <> 'admin' or new.status <> 'active') then
    raise exception 'You cannot remove your own admin access.';
  end if;
  new.forename := left(trim(new.forename), 50);
  new.surname := left(trim(new.surname), 50);
  new.phone := left(trim(new.phone), 20);
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- Work out hours and validate each entry
create or replace function public.entry_hours() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hours := round(((extract(epoch from (new.end_time - new.start_time)) / 60 - new.break_mins) / 60)::numeric, 2);
  if new.hours <= 0 then raise exception 'Finish time must be after start time (allowing for breaks).'; end if;
  if new.work_date > current_date then raise exception 'Hours cannot be logged for a future date.'; end if;
  if auth.uid() is not null and not is_admin() then new.user_id := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entries_hours on public.entries;
create trigger entries_hours before insert or update on public.entries
  for each row execute function public.entry_hours();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.entries enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or is_admin());
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles delete" on public.profiles for delete to authenticated using (is_admin());

drop policy if exists "invites admin" on public.staff_invites;
create policy "invites admin" on public.staff_invites for all to authenticated
  using (is_admin()) with check (is_admin());

-- Staff: own entries only; can add/edit/delete within the last 14 days. Admin: everything.
drop policy if exists "entries read" on public.entries;
create policy "entries read" on public.entries for select to authenticated
  using (user_id = auth.uid() or is_admin());
drop policy if exists "entries insert" on public.entries;
create policy "entries insert" on public.entries for insert to authenticated
  with check (is_admin() or (user_id = auth.uid() and is_active() and work_date >= current_date - 14));
drop policy if exists "entries update" on public.entries;
create policy "entries update" on public.entries for update to authenticated
  using (is_admin() or (user_id = auth.uid() and is_active() and work_date >= current_date - 14))
  with check (is_admin() or (user_id = auth.uid() and is_active() and work_date >= current_date - 14));
drop policy if exists "entries delete" on public.entries;
create policy "entries delete" on public.entries for delete to authenticated
  using (is_admin() or (user_id = auth.uid() and is_active() and work_date >= current_date - 14));

revoke all on public.profiles, public.staff_invites, public.entries from anon;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.staff_invites, public.entries to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- first administrator: CHANGE THESE DETAILS ----------
insert into public.staff_invites (email, forename, surname, phone, role)
values ('office@sladeadventure.co.uk', 'Office', 'Admin', '', 'admin')
on conflict (email) do update set role = 'admin';
