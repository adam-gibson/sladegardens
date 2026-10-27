-- Slade Gardens Timesheets – entry approval
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
-- Every entry must be approved by an admin. Approved entries are locked for staff.
-- If an approved entry is changed it goes back to "awaiting approval".
-- Every approval, un-approval and change/deletion of an approved entry is recorded in approval_log.

alter table public.entries add column if not exists approved_at timestamptz;
alter table public.entries add column if not exists approved_by uuid references public.profiles(id) on delete set null;
create index if not exists entries_awaiting on public.entries (work_date) where approved_at is null;

create table if not exists public.approval_log (
  id bigint generated always as identity primary key,
  entry_id bigint not null,           -- no foreign key, so the record survives if the entry is deleted
  staff_id uuid references public.profiles(id) on delete set null,
  work_date date,
  hours numeric(5, 2),
  action text not null check (action in ('approved', 'unapproved', 'changed after approval', 'deleted after approval')),
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz not null default now()
);
create index if not exists approval_log_entry on public.approval_log (entry_id);

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

-- Work out hours, validate, and control approval fields
create or replace function public.entry_hours() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hours := round(((extract(epoch from (new.end_time - new.start_time)) / 60 - new.break_mins) / 60)::numeric, 2);
  if new.hours <= 0 then raise exception 'Finish time must be after start time (allowing for breaks).'; end if;
  if new.work_date > current_date then raise exception 'Hours cannot be logged for a future date.'; end if;
  if auth.uid() is not null and not is_admin() then new.user_id := auth.uid(); end if;

  if tg_op = 'INSERT' then
    new.approved_at := null; new.approved_by := null; new.updated_at := now();
  elsif (new.user_id, new.work_date, new.start_time, new.end_time, new.break_mins, new.activity, new.notes)
        is distinct from (old.user_id, old.work_date, old.start_time, old.end_time, old.break_mins, old.activity, old.notes) then
    -- any change to the hours needs approving again
    new.approved_at := null; new.approved_by := null; new.updated_at := now();
  elsif auth.uid() is not null and not is_admin() then
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  elsif new.approved_at is not null and old.approved_at is null then
    new.approved_at := now(); new.approved_by := auth.uid();   -- time and approver are set by the database
  elsif new.approved_at is null then
    new.approved_by := null;
  else
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  end if;
  return new;
end $$;

create or replace function public.log_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'DELETE' then
    if old.approved_at is not null then
      insert into approval_log (entry_id, staff_id, work_date, hours, action, done_by)
      values (old.id, old.user_id, old.work_date, old.hours, 'deleted after approval', auth.uid());
    end if;
    return old;
  end if;
  if old.approved_at is null and new.approved_at is not null then act := 'approved';
  elsif old.approved_at is not null and new.approved_at is null then
    act := case when new.updated_at is distinct from old.updated_at then 'changed after approval' else 'unapproved' end;
  end if;
  if act is not null then
    insert into approval_log (entry_id, staff_id, work_date, hours, action, done_by)
    values (new.id, new.user_id, new.work_date, new.hours, act, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists entries_log_approval on public.entries;
create trigger entries_log_approval after update or delete on public.entries
  for each row execute function public.log_approval();
revoke execute on function public.log_approval() from public, anon, authenticated;

-- Staff can only change or delete their own entries that are recent AND not yet approved
drop policy if exists "entries update" on public.entries;
create policy "entries update" on public.entries for update to authenticated
  using (is_admin() or (user_id = auth.uid() and is_active() and approved_at is null and work_date >= current_date - 14))
  with check (is_admin() or (user_id = auth.uid() and is_active() and work_date >= current_date - 14));
drop policy if exists "entries delete" on public.entries;
create policy "entries delete" on public.entries for delete to authenticated
  using (is_admin() or (user_id = auth.uid() and is_active() and approved_at is null and work_date >= current_date - 14));

-- Only admins can read the approval record; nobody can edit it from the app
alter table public.approval_log enable row level security;
drop policy if exists "approval log read" on public.approval_log;
create policy "approval log read" on public.approval_log for select to authenticated using (is_admin());
revoke all on public.approval_log from anon, authenticated;
grant select on public.approval_log to authenticated;
