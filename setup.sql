-- LockDesk: add parts ordering (safe to run more than once)
do $$
declare job_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into job_id_type
  from pg_attribute a
  where a.attrelid = 'public.jobs'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists public.job_parts (
      id uuid primary key default gen_random_uuid(),
      job_id %s not null references public.jobs(id) on delete cascade,
      name text not null,
      part_number text,
      quantity integer not null default 1 check (quantity > 0),
      supplier text,
      cost numeric(10,2),
      status text not null default 'needed'
        check (status in ('needed','ordered','received','installed','cancelled')),
      notes text,
      expected_on date,
      ordered_at timestamptz,
      received_at timestamptz,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now()
    )$f$, job_id_type);
end $$;

create index if not exists job_parts_job_id_idx on public.job_parts(job_id);
create index if not exists job_parts_status_idx on public.job_parts(status);

alter table public.job_parts enable row level security;

drop policy if exists "job_parts_select" on public.job_parts;
drop policy if exists "job_parts_insert" on public.job_parts;
drop policy if exists "job_parts_update" on public.job_parts;
drop policy if exists "job_parts_delete" on public.job_parts;

create policy "job_parts_select" on public.job_parts for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_parts.job_id));
create policy "job_parts_insert" on public.job_parts for insert to authenticated
  with check (exists (select 1 from public.jobs j where j.id = job_parts.job_id));
create policy "job_parts_update" on public.job_parts for update to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_parts.job_id))
  with check (exists (select 1 from public.jobs j where j.id = job_parts.job_id));
create policy "job_parts_delete" on public.job_parts for delete to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_parts.job_id));

revoke all on public.job_parts from anon;
grant select, insert, update, delete on public.job_parts to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.job_parts;
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- LockDesk security update: owner approval for every account
-- Safe to run more than once. Adds to your database; does not remove
-- any of your existing tables, data, or security policies.
--
-- What it does
--   1. Every new account starts as PENDING and can see nothing.
--   2. Only the approved Owner can approve, remove, or reset accounts.
--   3. Forgot password requests go to the Owner.
--   4. Optional: emails the Owner on every signup / reset request
--      (turns on once a Resend API key is saved; see the end).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. Approval columns on profiles ----------
alter table public.profiles add column if not exists approved boolean not null default false;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid;

-- Existing owners stay approved so you are never locked out.
update public.profiles
   set approved = true, approved_at = coalesce(approved_at, now())
 where role::text = 'owner' and approved = false;

-- ---------- 2. Helper checks ----------
create or replace function public.ld_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.ld_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text = 'owner' from public.profiles p where p.id = auth.uid()), false)
$$;

grant execute on function public.ld_is_approved() to anon, authenticated;
grant execute on function public.ld_is_owner() to anon, authenticated;

-- ---------- 3. Private settings (never readable from the app) ----------
create schema if not exists ld_private;
revoke all on schema ld_private from public, anon, authenticated;
create table if not exists ld_private.settings (
  key text primary key,
  value text not null
);
revoke all on ld_private.settings from public, anon, authenticated;

-- ---------- 4. Owner email alerts (no-op until a Resend key is saved) ----------
create or replace function public.ld_notify_owner(p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_from text;
  v_to text;
begin
  select value into v_key from ld_private.settings where key = 'resend_api_key';
  if v_key is null or v_key = '' then return; end if;
  select value into v_from from ld_private.settings where key = 'email_from';
  select value into v_to from ld_private.settings where key = 'owner_email';
  if v_to is null then
    select u.email into v_to
      from public.profiles p join auth.users u on u.id = p.id
     where p.role::text = 'owner' and p.approved
     order by p.approved_at nulls last limit 1;
  end if;
  if v_to is null then return; end if;
  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', coalesce(v_from, 'LockDesk <onboarding@resend.dev>'),
        'to', jsonb_build_array(v_to),
        'subject', p_subject,
        'text', p_body)
    );
  exception when others then
    -- Email trouble must never block signups or resets.
    raise warning 'LockDesk owner email failed: %', sqlerrm;
  end;
end $$;
revoke all on function public.ld_notify_owner(text, text) from public, anon, authenticated;

-- ---------- 5. Guard: new profiles start pending; only Owner changes approval ----------
create or replace function public.ld_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Very first owner bootstraps as approved; everyone else waits.
    if new.role::text = 'owner'
       and not exists (select 1 from public.profiles where approved and role::text = 'owner') then
      new.approved := true;
      new.approved_at := now();
    else
      new.approved := false;
      new.approved_at := null;
      new.approved_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.approved is distinct from old.approved
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    if auth.uid() is not null and not public.ld_is_owner()
       -- (a person may always give up their own access, e.g. deleting their account)
       and not (new.id = auth.uid() and new.approved = false and new.approved_by is not distinct from old.approved_by) then
      raise exception 'Only the owner can approve or remove accounts.';
    end if;
  end if;
  -- An unapproved user can never change their own role.
  if new.role is distinct from old.role and auth.uid() is not null and not public.ld_is_approved() then
    raise exception 'Your account is waiting for approval.';
  end if;
  return new;
end $$;

drop trigger if exists zz_ld_profile_guard on public.profiles;
create trigger zz_ld_profile_guard
  before insert or update on public.profiles
  for each row execute function public.ld_profile_guard();

-- Alert the owner when someone new signs up
create or replace function public.ld_profile_signup_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.approved then return new; end if;
  select email into v_email from auth.users where id = new.id;
  perform public.ld_notify_owner(
    'LockDesk: new account waiting for approval',
    coalesce(v_email, 'Someone') || ' just requested access to LockDesk.' || chr(10) || chr(10) ||
    'Open LockDesk and go to Team to approve or deny.');
  return new;
end $$;

drop trigger if exists zz_ld_profile_signup_alert on public.profiles;
create trigger zz_ld_profile_signup_alert
  after insert on public.profiles
  for each row execute function public.ld_profile_signup_alert();

-- ---------- 6. Lock every LockDesk table to approved users only ----------
-- RESTRICTIVE policies are added ON TOP of your existing policies:
-- your current rules still apply, and the user must also be approved.
do $$
declare t text;
begin
  foreach t in array array['customers','jobs','job_events','payments','notifications','job_attachments','job_parts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists ld_approved_only on public.%I', t);
      execute format(
        'create policy ld_approved_only on public.%I as restrictive for all to public
           using (public.ld_is_approved()) with check (public.ld_is_approved())', t);
    end if;
  end loop;
end $$;

-- Profiles: approved staff as before; a pending user can only see their own row.
drop policy if exists ld_approved_only on public.profiles;
create policy ld_approved_only on public.profiles as restrictive for all to public
  using (public.ld_is_approved() or id = auth.uid())
  with check (public.ld_is_approved() or id = auth.uid());

-- ---------- 7. Access requests (password resets) ----------
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('password_reset')),
  email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz
);
create index if not exists access_requests_open_idx on public.access_requests(status, created_at);
alter table public.access_requests enable row level security;
drop policy if exists ld_owner_only on public.access_requests;
create policy ld_owner_only on public.access_requests for all to authenticated
  using (public.ld_is_owner()) with check (public.ld_is_owner());
revoke all on public.access_requests from anon;
grant select, update, delete on public.access_requests to authenticated;

-- Anyone on the sign in screen can ask for a reset. It never reveals
-- whether an email exists, and it is rate limited.
create or replace function public.ld_request_password_reset(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid uuid;
begin
  if length(v_email) < 5 or length(v_email) > 254 or position('@' in v_email) = 0 then return; end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 30 then return; end if;
  if exists (select 1 from public.access_requests
              where lower(email) = v_email and created_at > now() - interval '15 minutes') then return; end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then return; end if;
  insert into public.access_requests (kind, email, user_id) values ('password_reset', v_email, v_uid);
  perform public.ld_notify_owner(
    'LockDesk: password reset request',
    v_email || ' asked for a password reset.' || chr(10) || chr(10) ||
    'Open LockDesk, go to Team, and set a new temporary password for them.');
end $$;
revoke all on function public.ld_request_password_reset(text) from public;
grant execute on function public.ld_request_password_reset(text) to anon, authenticated;

-- ---------- 8. Owner actions ----------
create or replace function public.ld_approve_user(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can approve accounts.'; end if;
  if p_role not in ('owner', 'dispatcher', 'technician') then raise exception 'Unknown role.'; end if;
  update public.profiles
     set approved = true, approved_at = now(), approved_by = auth.uid(), role = p_role::public.app_role
   where id = p_user;
  if not found then raise exception 'Account not found.'; end if;
  -- Approval replaces email confirmation, and lifts any earlier removal.
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null
   where id = p_user;
end $$;

create or replace function public.ld_remove_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can remove accounts.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove your own account here.'; end if;
  update public.profiles set approved = false, approved_at = null, approved_by = null where id = p_user;
  -- Block sign in completely; history (jobs, payments) stays intact.
  update auth.users set banned_until = 'infinity' where id = p_user;
  update public.access_requests set status = 'dismissed', handled_by = auth.uid(), handled_at = now()
   where user_id = p_user and status = 'open';
end $$;

create or replace function public.ld_set_user_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can reset passwords.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'Account not found.'; end if;
  update public.access_requests set status = 'done', handled_by = auth.uid(), handled_at = now()
   where user_id = p_user and kind = 'password_reset' and status = 'open';
end $$;

-- Lets the owner see each pending person's email.
drop function if exists public.ld_account_emails();
create or replace function public.ld_account_emails() returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, removed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then return; end if;
  return query select u.id, u.email::text, u.created_at, u.last_sign_in_at,
                      coalesce(u.banned_until > now(), false)
                 from auth.users u;
end $$;

-- Any user can delete their own account (required by the App Store).
create or replace function public.ld_delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if public.ld_is_owner()
     and (select count(*) from public.profiles where approved and role::text = 'owner') <= 1 then
    raise exception 'You are the only owner. Make someone else owner first.';
  end if;
  begin
    delete from auth.users where id = v_uid;
  exception when foreign_key_violation then
    -- Their name is on past jobs: remove access and personal details, keep job history.
    update public.profiles set approved = false where id = v_uid;
    update auth.users
       set banned_until = 'infinity',
           email = 'deleted+' || replace(v_uid::text, '-', '') || '@deleted.invalid',
           encrypted_password = null
     where id = v_uid;
  end;
end $$;

revoke all on function public.ld_approve_user(uuid, text) from public, anon;
revoke all on function public.ld_remove_user(uuid) from public, anon;
revoke all on function public.ld_set_user_password(uuid, text) from public, anon;
revoke all on function public.ld_account_emails() from public, anon;
revoke all on function public.ld_delete_my_account() from public, anon;
grant execute on function public.ld_approve_user(uuid, text) to authenticated;
grant execute on function public.ld_remove_user(uuid) to authenticated;
grant execute on function public.ld_set_user_password(uuid, text) to authenticated;
grant execute on function public.ld_account_emails() to authenticated;
grant execute on function public.ld_delete_my_account() to authenticated;

-- Realtime for the owner's approval list
do $$
begin
  alter publication supabase_realtime add table public.access_requests;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object or undefined_object then null;
end $$;

-- Needed for owner email alerts
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise warning 'pg_net not available; owner email alerts stay off: %', sqlerrm;
end $$;

-- =====================================================================
-- OPTIONAL, LATER: turn on owner email alerts.
-- 1. Make a free account at resend.com using the email you want alerts at.
-- 2. Create an API key there, then run (with your key):
--      insert into ld_private.settings (key, value) values ('resend_api_key', 're_your_key_here')
--      on conflict (key) do update set value = excluded.value;
-- =====================================================================
