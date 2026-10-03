-- =====================================================================
--  ShowOps — database setup for Supabase
--
--  HOW TO USE
--  1. In Supabase, open  SQL Editor  →  New query
--  2. Paste EVERYTHING in this file
--  3. Click  Run
--  You should see "Success. No rows returned".
--
--  It is safe to run this file again later: it never deletes your data.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES  (think of each one as a tab in a spreadsheet)
-- ---------------------------------------------------------------------

-- People who use the app. One row is created automatically when someone signs up.
-- Roles:  pending  = signed up, waiting for a Manager to approve
--         writer   = can raise requests (only inside the request window)
--         ops      = can assign / reassign / update tasks, add shows
--         manager  = everything, incl. priority, roles and settings
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  role        text not null default 'pending'
              check (role in ('pending','writer','ops','manager')),
  created_at  timestamptz not null default now()
);

-- App settings (only ever one row).
create table if not exists public.settings (
  id             int primary key default 1 check (id = 1),
  request_start  time not null default '06:00',
  request_end    time not null default '18:30',
  timezone       text not null default 'Asia/Kolkata'
);

-- Shows Master
create table if not exists public.shows (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  type        text not null default 'Other' check (type in ('EU','UK','Other')),
  approved    boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Tasks / requests
create table if not exists public.tasks (
  id            bigint generated always as identity primary key,
  show_id       bigint not null references public.shows(id) on delete cascade,
  title         text not null,
  details       text,
  assigned_to   uuid references public.profiles(id) on delete set null,
  status        text not null default 'Unassigned'
                check (status in ('Unassigned','Assigned','In Progress','Blocked','Completed')),
  hml           text not null default 'Low'    check (hml in ('High','Medium','Low')),
  p_level       text not null default 'P2'     check (p_level in ('P0','P1','P2')),
  high_flag     boolean not null default false,
  deadline      date,
  raised_by     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- Blockers / issues
create table if not exists public.issues (
  id           bigint generated always as identity primary key,
  show_id      bigint not null references public.shows(id) on delete cascade,
  task_id      bigint references public.tasks(id) on delete set null,
  description  text not null,
  severity     text not null default 'Medium' check (severity in ('Critical','High','Medium','Low')),
  status       text not null default 'Open'   check (status in ('Open','Investigating','Resolved')),
  raised_by    uuid references public.profiles(id) on delete set null,
  owner        uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- Activity log (filled in automatically — nobody can edit or delete it)
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,
  show_id     bigint references public.shows(id) on delete set null,
  task_id     bigint references public.tasks(id) on delete set null,
  details     text
);

create index if not exists tasks_show_idx      on public.tasks(show_id);
create index if not exists tasks_assignee_idx  on public.tasks(assigned_to);
create index if not exists issues_show_idx     on public.issues(show_id);
create index if not exists log_created_idx     on public.activity_log(created_at desc);
create index if not exists log_show_idx        on public.activity_log(show_id);


-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS  (small questions the security rules ask)
-- ---------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('writer','ops','manager') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('ops','manager') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.person_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = uid
$$;

create or replace function public.log_event(p_action text, p_show bigint, p_task bigint, p_details text)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log (user_id, action, show_id, task_id, details)
  values (auth.uid(), p_action, p_show, p_task, p_details);
$$;


-- ---------------------------------------------------------------------
-- 3. AUTOMATIC RULES  (triggers)
-- ---------------------------------------------------------------------

-- 3a. New sign-up → create their profile. The very first person becomes Manager.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when not exists (select 1 from public.profiles) then 'manager' else 'pending' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3b. Only a Manager can change roles; the last Manager can't demote themselves.
create or replace function public.profiles_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    if not public.is_manager() then
      raise exception 'Only a Manager can change roles.';
    end if;
    if old.role = 'manager'
       and (select count(*) from public.profiles where role = 'manager') <= 1 then
      raise exception 'This is the only Manager. Make someone else Manager first.';
    end if;
  end if;
  new.id := old.id;
  return new;
end $$;

create or replace function public.profiles_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('New Sign-up', null, null, new.full_name || ' (' || coalesce(new.email, '') || ')');
  elsif new.role is distinct from old.role then
    perform public.log_event('Role Changed', null, null, new.full_name || ': ' || old.role || ' → ' || new.role);
  end if;
  return new;
end $$;

drop trigger if exists profiles_before on public.profiles;
create trigger profiles_before before update on public.profiles
  for each row execute function public.profiles_before();
drop trigger if exists profiles_after on public.profiles;
create trigger profiles_after after insert or update on public.profiles
  for each row execute function public.profiles_after();

-- 3c. Shows → log when added / approved / edited
create or replace function public.shows_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('Show Added', new.id, null, 'Type: ' || new.type);
  else
    if new.approved is distinct from old.approved then
      perform public.log_event(case when new.approved then 'Show Approved' else 'Show Paused' end, new.id, null, new.name);
    end if;
    if new.name is distinct from old.name or new.type is distinct from old.type then
      perform public.log_event('Show Edited', new.id, null, new.name || ' · ' || new.type);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists shows_after on public.shows;
create trigger shows_after after insert or update on public.shows
  for each row execute function public.shows_after();

-- 3d. Tasks → request window, who-can-change-what, automatic status
create or replace function public.tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s          public.settings%rowtype;
  now_local  time;
  r          text := coalesce(public.my_role(), '');
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.raised_by := auth.uid();
      if not exists (select 1 from public.shows where id = new.show_id and approved) then
        raise exception 'This show is not approved for requests yet.';
      end if;
      if r = 'writer' then
        select * into s from public.settings where id = 1;
        if found then
          now_local := (now() at time zone s.timezone)::time;
          if now_local < s.request_start or now_local > s.request_end then
            raise exception 'Requests are closed right now. Writers can raise requests between % and %.',
              to_char(s.request_start, 'HH24:MI'), to_char(s.request_end, 'HH24:MI');
          end if;
        end if;
        new.assigned_to := null;
      end if;
      if r <> 'manager' then
        new.hml := 'Low'; new.p_level := 'P2'; new.high_flag := false;
      end if;
    end if;
    if new.assigned_to is null then
      new.status := 'Unassigned';
    elsif new.status = 'Unassigned' then
      new.status := 'Assigned';
    end if;
    new.completed_at := case when new.status = 'Completed' then now() else null end;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if auth.uid() is not null then
    if r <> 'manager' and (new.hml, new.p_level, new.high_flag) is distinct from (old.hml, old.p_level, old.high_flag) then
      raise exception 'Only a Manager can change priority (H/M/L, P0/P1/P2, High flag).';
    end if;
    if r not in ('ops','manager') and (
         new.assigned_to is distinct from old.assigned_to or new.show_id is distinct from old.show_id or
         new.title is distinct from old.title or new.deadline is distinct from old.deadline or
         new.details is distinct from old.details) then
      raise exception 'You can only change the status of your own tasks.';
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null and new.status in ('Assigned','In Progress') then
      new.status := 'Unassigned';
    elsif new.assigned_to is not null and new.status = 'Unassigned' then
      new.status := 'Assigned';
    end if;
  end if;
  if new.assigned_to is null and new.status in ('Assigned','In Progress') then
    new.status := 'Unassigned';
  end if;
  if new.assigned_to is not null and new.status = 'Unassigned' then
    new.status := 'Assigned';
  end if;

  if new.status = 'Completed' and old.status <> 'Completed' then
    new.completed_at := now();
  elsif new.status <> 'Completed' then
    new.completed_at := null;
  end if;
  new.raised_by  := old.raised_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

-- 3e. Tasks → write to the activity log
create or replace function public.tasks_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('Request Raised', new.show_id, new.id, new.title);
    if new.assigned_to is not null then
      perform public.log_event('Assigned', new.show_id, new.id,
        new.title || ' → ' || coalesce(public.person_name(new.assigned_to), '?'));
    end if;
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.log_event(
      case when old.assigned_to is null then 'Assigned'
           when new.assigned_to is null then 'Unassigned'
           else 'Reassigned' end,
      new.show_id, new.id,
      new.title || ' → ' || coalesce(public.person_name(new.assigned_to), 'nobody'));
  end if;

  if new.status is distinct from old.status
     and not (new.assigned_to is distinct from old.assigned_to
              and (old.status = 'Unassigned' or new.status = 'Unassigned')) then
    perform public.log_event(
      case when new.status = 'Completed' then 'Task Completed'
           when old.status = 'Completed' then 'Task Reopened'
           when new.status = 'Blocked'   then 'Task Blocked'
           else 'Status Changed' end,
      new.show_id, new.id, new.title || ': ' || old.status || ' → ' || new.status);
  end if;

  if (new.hml, new.p_level, new.high_flag) is distinct from (old.hml, old.p_level, old.high_flag) then
    perform public.log_event('Priority Changed', new.show_id, new.id,
      new.title || ': ' || new.hml || ' / ' || new.p_level ||
      case when new.high_flag then ' / High flag' else '' end);
  end if;

  if new.deadline is distinct from old.deadline then
    perform public.log_event('Deadline Changed', new.show_id, new.id,
      new.title || ': ' || coalesce(to_char(new.deadline, 'DD Mon YYYY'), 'no deadline'));
  end if;

  if new.title is distinct from old.title or new.show_id is distinct from old.show_id then
    perform public.log_event('Task Edited', new.show_id, new.id, new.title);
  end if;
  return new;
end $$;

drop trigger if exists tasks_before on public.tasks;
create trigger tasks_before before insert or update on public.tasks
  for each row execute function public.tasks_before();
drop trigger if exists tasks_after on public.tasks;
create trigger tasks_after after insert or update on public.tasks
  for each row execute function public.tasks_after();

-- 3f. Issues → timestamps, log, and mark the linked task Blocked / unblocked
create or replace function public.issues_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.raised_by := auth.uid(); end if;
    if new.owner is null then new.owner := new.raised_by; end if;
    new.created_at := now();
  else
    new.raised_by  := old.raised_by;
    new.created_at := old.created_at;
  end if;
  if new.status = 'Resolved' then
    if tg_op = 'INSERT' or old.status <> 'Resolved' then new.resolved_at := now(); end if;
  else
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.issues_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t           public.tasks%rowtype;
  open_count  int;
begin
  if tg_op = 'INSERT' then
    perform public.log_event('Blocker Raised', new.show_id, new.task_id,
      new.description || ' (' || new.severity || ')');
  elsif new.status is distinct from old.status then
    perform public.log_event('Blocker ' || new.status, new.show_id, new.task_id, new.description);
  end if;

  if new.task_id is not null then
    select * into t from public.tasks where id = new.task_id;
    if found and t.status <> 'Completed' then
      select count(*) into open_count from public.issues
        where task_id = new.task_id and status <> 'Resolved';
      if open_count > 0 and t.status <> 'Blocked' then
        update public.tasks set status = 'Blocked' where id = t.id;
      elsif open_count = 0 and t.status = 'Blocked' then
        update public.tasks
          set status = case when t.assigned_to is null then 'Unassigned' else 'Assigned' end
          where id = t.id;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists issues_before on public.issues;
create trigger issues_before before insert or update on public.issues
  for each row execute function public.issues_before();
drop trigger if exists issues_after on public.issues;
create trigger issues_after after insert or update on public.issues
  for each row execute function public.issues_after();


-- ---------------------------------------------------------------------
-- 4. SECURITY RULES  (who can see / change what)
-- ---------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.settings     enable row level security;
alter table public.shows        enable row level security;
alter table public.tasks        enable row level security;
alter table public.issues       enable row level security;
alter table public.activity_log enable row level security;

-- profiles
drop policy if exists "profiles: read"   on public.profiles;
create policy "profiles: read"   on public.profiles for select to authenticated
  using (public.is_member() or id = auth.uid());
drop policy if exists "profiles: update" on public.profiles;
create policy "profiles: update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_manager())
  with check (id = auth.uid() or public.is_manager());

-- settings
drop policy if exists "settings: read"   on public.settings;
create policy "settings: read"   on public.settings for select to authenticated using (true);
drop policy if exists "settings: update" on public.settings;
create policy "settings: update" on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- shows
drop policy if exists "shows: read"   on public.shows;
create policy "shows: read"   on public.shows for select to authenticated using (public.is_member());
drop policy if exists "shows: insert" on public.shows;
create policy "shows: insert" on public.shows for insert to authenticated with check (public.is_staff());
drop policy if exists "shows: update" on public.shows;
create policy "shows: update" on public.shows for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "shows: delete" on public.shows;
create policy "shows: delete" on public.shows for delete to authenticated using (public.is_manager());

-- tasks
drop policy if exists "tasks: read"   on public.tasks;
create policy "tasks: read"   on public.tasks for select to authenticated using (public.is_member());
drop policy if exists "tasks: insert" on public.tasks;
create policy "tasks: insert" on public.tasks for insert to authenticated with check (public.is_member());
drop policy if exists "tasks: update" on public.tasks;
create policy "tasks: update" on public.tasks for update to authenticated
  using (public.is_staff() or (public.is_member() and assigned_to = auth.uid()))
  with check (public.is_staff() or (public.is_member() and assigned_to = auth.uid()));
drop policy if exists "tasks: delete" on public.tasks;
create policy "tasks: delete" on public.tasks for delete to authenticated using (public.is_manager());

-- issues
drop policy if exists "issues: read"   on public.issues;
create policy "issues: read"   on public.issues for select to authenticated using (public.is_member());
drop policy if exists "issues: insert" on public.issues;
create policy "issues: insert" on public.issues for insert to authenticated with check (public.is_member());
drop policy if exists "issues: update" on public.issues;
create policy "issues: update" on public.issues for update to authenticated
  using (public.is_staff() or (public.is_member() and (owner = auth.uid() or raised_by = auth.uid())))
  with check (public.is_member());
drop policy if exists "issues: delete" on public.issues;
create policy "issues: delete" on public.issues for delete to authenticated using (public.is_manager());

-- activity log: read only (the triggers above write to it)
drop policy if exists "log: read" on public.activity_log;
create policy "log: read" on public.activity_log for select to authenticated using (public.is_member());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.settings, public.shows,
  public.tasks, public.issues to authenticated;
grant select on public.activity_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- ---------------------------------------------------------------------
-- 5. LIVE UPDATES  (so everyone sees changes instantly)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','settings','shows','tasks','issues','activity_log'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6. STARTING DATA
-- ---------------------------------------------------------------------
insert into public.settings (id) values (1) on conflict (id) do nothing;

insert into public.shows (name, type) values
  ('Adhoc', 'Other'),
  ('Rise of the War God', 'Other'),
  ('Vampyria', 'EU'),
  ('Kingston University', 'EU'),
  ('Ancient Martial God', 'UK')
on conflict (name) do nothing;

-- If anyone signed up BEFORE this file was run, give them a profile too.
insert into public.profiles (id, full_name, email, role)
select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)), u.email, 'pending'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set role = 'manager'
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'manager');

-- Done! ✔
