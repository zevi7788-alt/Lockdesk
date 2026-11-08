
-- =====================================================================
-- LockDesk: invite only accounts and per device access
-- Safe to run more than once.
--
--   1. Nobody can create an account except the owner (from Team).
--   2. Each account only works on devices the owner set up with a
--      one time device link. A stolen password alone gets nothing.
--   3. Deactivating someone instantly cuts off every device they have.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists ld_private;
revoke all on schema ld_private from public, anon, authenticated;

create table if not exists ld_private.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Device',
  secret_hash text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists devices_user_idx on ld_private.devices(user_id);

create table if not exists ld_private.device_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  device_id uuid
);
create index if not exists device_links_user_idx on ld_private.device_links(user_id);

create table if not exists ld_private.device_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references ld_private.devices(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Emails the owner has just created an account for (valid 10 minutes).
create table if not exists ld_private.allowed_signups (
  email text primary key,
  created_by uuid,
  expires_at timestamptz not null
);

revoke all on all tables in schema ld_private from public, anon, authenticated;

create or replace function ld_private.sha(p text) returns text
language sql immutable set search_path = public as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

-- ---------- The core check: is this login session on a set up device? ----------
create or replace function public.ld_session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ld_private.device_sessions s
      join ld_private.devices d on d.id = s.device_id
     where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
       and s.user_id = auth.uid() and d.user_id = auth.uid()
       and d.revoked_at is null)
$$;
grant execute on function public.ld_session_ok() to anon, authenticated;

-- Every table and owner action already goes through these checks,
-- so adding the device rule here covers the whole app.
create or replace function public.ld_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved from public.profiles p where p.id = auth.uid()), false)
         and public.ld_session_ok()
$$;
create or replace function public.ld_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text = 'owner' from public.profiles p where p.id = auth.uid()), false)
         and public.ld_session_ok()
$$;
create or replace function public.ld_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text in ('owner', 'dispatcher')
                     from public.profiles p where p.id = auth.uid()), false)
         and public.ld_session_ok()
$$;
create or replace function public.ld_is_tech() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text = 'technician' from public.profiles p where p.id = auth.uid()), false)
$$;

-- ---------- No public sign ups: only emails the owner allowed ----------
create or replace function ld_private.only_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from ld_private.allowed_signups where expires_at < now();
  delete from ld_private.allowed_signups where email = lower(new.email);
  if not found then
    raise exception 'Sign ups are closed. Ask the owner for an account.';
  end if;
  return new;
end $$;
drop trigger if exists aa_ld_only_invited on auth.users;
create trigger aa_ld_only_invited before insert on auth.users
  for each row execute function ld_private.only_invited();

create or replace function public.ld_allow_signup(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_email, '')));
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can create accounts.'; end if;
  if position('@' in v) = 0 then raise exception 'Enter a valid email.'; end if;
  insert into ld_private.allowed_signups (email, created_by, expires_at)
  values (v, auth.uid(), now() + interval '10 minutes')
  on conflict (email) do update set expires_at = excluded.expires_at, created_by = excluded.created_by;
end $$;
revoke all on function public.ld_allow_signup(text) from public, anon;
grant execute on function public.ld_allow_signup(text) to authenticated;

-- ---------- Device links ----------
create or replace function ld_private.make_link(p_user uuid, p_hours int, p_by uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  -- Only one open link per person at a time
  update ld_private.device_links set cancelled_at = now()
   where user_id = p_user and used_at is null and cancelled_at is null;
  insert into ld_private.device_links (user_id, token_hash, created_by, expires_at)
  values (p_user, ld_private.sha(v_token), p_by, now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 72), 168))));
  return v_token;
end $$;

create or replace function public.ld_new_device_link(p_user uuid, p_hours int default 72) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can make device links.'; end if;
  if not exists (select 1 from public.profiles where id = p_user and approved) then
    raise exception 'This account is deactivated. Reactivate it first.';
  end if;
  return ld_private.make_link(p_user, p_hours, auth.uid());
end $$;
revoke all on function public.ld_new_device_link(uuid, int) from public, anon;
grant execute on function public.ld_new_device_link(uuid, int) to authenticated;

-- Opened on the new phone: turns the link into a device key stored on that phone.
create or replace function public.ld_enroll_device(p_token text, p_secret text, p_label text) returns json
language plpgsql security definer set search_path = public as $$
declare l ld_private.device_links; v_dev uuid; v_email text; v_name text;
begin
  if length(coalesce(p_secret, '')) < 40 then raise exception 'Invalid device key.'; end if;
  select * into l from ld_private.device_links where token_hash = ld_private.sha(p_token) for update;
  if l.id is null or l.used_at is not null or l.cancelled_at is not null or l.expires_at < now() then
    raise exception 'This setup link was already used or has expired. Ask the owner for a new one.';
  end if;
  if not exists (select 1 from public.profiles where id = l.user_id and approved) then
    raise exception 'This account is deactivated.';
  end if;
  insert into ld_private.devices (user_id, label, secret_hash, created_by)
  values (l.user_id, left(coalesce(nullif(trim(p_label), ''), 'Device'), 60), ld_private.sha(p_secret), l.created_by)
  returning id into v_dev;
  update ld_private.device_links set used_at = now(), device_id = v_dev where id = l.id;
  -- Staff get one phone each: a new phone switches off their old one.
  -- (The owner may keep several, like a phone and a computer.)
  if not exists (select 1 from public.profiles where id = l.user_id and role::text = 'owner') then
    perform ld_private.kill_sessions(l.user_id, d2.id)
       from ld_private.devices d2 where d2.user_id = l.user_id and d2.id <> v_dev and d2.revoked_at is null;
    update ld_private.devices set revoked_at = now()
     where user_id = l.user_id and id <> v_dev and revoked_at is null;
  end if;
  select u.email::text, coalesce(p.full_name, '') into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id where u.id = l.user_id;
  return json_build_object('email', v_email, 'name', v_name);
end $$;
revoke all on function public.ld_enroll_device(text, text, text) from public;
grant execute on function public.ld_enroll_device(text, text, text) to anon, authenticated;

-- Lets a set up device show its sign in screen (and nothing else).
create or replace function public.ld_device_status(p_secret text) returns json
language plpgsql stable security definer set search_path = public as $$
declare d ld_private.devices; v_email text; v_name text; v_ok boolean;
begin
  select * into d from ld_private.devices where secret_hash = ld_private.sha(p_secret);
  if d.id is null or d.revoked_at is not null then return json_build_object('ok', false); end if;
  select u.email::text, coalesce(p.full_name, ''), coalesce(p.approved, false) and coalesce(u.banned_until, now() - interval '1 second') < now()
    into v_email, v_name, v_ok
    from auth.users u left join public.profiles p on p.id = u.id where u.id = d.user_id;
  if not coalesce(v_ok, false) then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'email', v_email, 'name', v_name);
end $$;
revoke all on function public.ld_device_status(text) from public;
grant execute on function public.ld_device_status(text) to anon, authenticated;

-- Called right after sign in: ties this login session to this device.
create or replace function public.ld_bind_session(p_secret text) returns text
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; d ld_private.devices;
begin
  if auth.uid() is null or v_sid is null then raise exception 'Not signed in.'; end if;
  select * into d from ld_private.devices
   where secret_hash = ld_private.sha(p_secret) and user_id = auth.uid() and revoked_at is null;
  if d.id is null then raise exception 'This device is not set up for this account. Ask the owner for a device link.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and approved) then
    raise exception 'This account is deactivated.';
  end if;
  insert into ld_private.device_sessions (session_id, user_id, device_id) values (v_sid, auth.uid(), d.id)
  on conflict (session_id) do nothing;
  if not exists (select 1 from ld_private.device_sessions where session_id = v_sid and device_id = d.id) then
    raise exception 'This login belongs to another device.';
  end if;
  update ld_private.devices set last_seen_at = now() where id = d.id;
  return 'ok';
end $$;
revoke all on function public.ld_bind_session(text) from public, anon;
grant execute on function public.ld_bind_session(text) to authenticated;

-- ---------- Owner: devices, deactivate, reactivate ----------
create or replace function public.ld_list_devices()
returns table (kind text, id uuid, user_id uuid, label text, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then return; end if;
  return query
    select 'device'::text, d.id, d.user_id, d.label, d.created_at, d.last_seen_at, null::timestamptz
      from ld_private.devices d where d.revoked_at is null
    union all
    select 'link'::text, l.id, l.user_id, 'Setup link'::text, l.created_at, null::timestamptz, l.expires_at
      from ld_private.device_links l where l.used_at is null and l.cancelled_at is null and l.expires_at > now();
end $$;
revoke all on function public.ld_list_devices() from public, anon;
grant execute on function public.ld_list_devices() to authenticated;

create or replace function ld_private.kill_sessions(p_user uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.sessions where id in (
    select session_id from ld_private.device_sessions
     where user_id = p_user and (p_device is null or device_id = p_device));
  delete from ld_private.device_sessions where user_id = p_user and (p_device is null or device_id = p_device);
  if p_device is null then delete from auth.sessions where user_id = p_user; end if;
end $$;

create or replace function public.ld_revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can turn off devices.'; end if;
  select user_id into v_user from ld_private.devices where id = p_device;
  if v_user is null then
    update ld_private.device_links set cancelled_at = now() where id = p_device and used_at is null;
    return;
  end if;
  if v_user = auth.uid() and p_device = (select device_id from ld_private.device_sessions
       where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid) then
    raise exception 'You cannot turn off the device you are using right now.';
  end if;
  update ld_private.devices set revoked_at = now() where id = p_device;
  perform ld_private.kill_sessions(v_user, p_device);
end $$;
revoke all on function public.ld_revoke_device(uuid) from public, anon;
grant execute on function public.ld_revoke_device(uuid) to authenticated;

create or replace function public.ld_deactivate_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can deactivate accounts.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot deactivate your own account.'; end if;
  update public.profiles set approved = false, approved_at = null, approved_by = null where id = p_user;
  update auth.users set banned_until = '2999-01-01'::timestamptz where id = p_user;
  update ld_private.devices set revoked_at = now() where user_id = p_user and revoked_at is null;
  update ld_private.device_links set cancelled_at = now() where user_id = p_user and used_at is null and cancelled_at is null;
  perform ld_private.kill_sessions(p_user, null);
  update public.access_requests set status = 'dismissed', handled_by = auth.uid(), handled_at = now()
   where user_id = p_user and status = 'open';
end $$;
revoke all on function public.ld_deactivate_user(uuid) from public, anon;
grant execute on function public.ld_deactivate_user(uuid) to authenticated;

-- Old "Remove" button now does a full deactivate.
create or replace function public.ld_remove_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform public.ld_deactivate_user(p_user); end $$;

-- Reactivate gives back access and returns a fresh device link (old devices stay off).
create or replace function public.ld_reactivate_user(p_user uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can reactivate accounts.'; end if;
  if p_role not in ('technician', 'dispatcher', 'owner') then raise exception 'Unknown role.'; end if;
  update auth.users set banned_until = null where id = p_user;
  update public.profiles set approved = true, role = p_role::app_role, approved_at = now(), approved_by = auth.uid() where id = p_user;
  if not found then raise exception 'Account not found.'; end if;
  return ld_private.make_link(p_user, 72, auth.uid());
end $$;
revoke all on function public.ld_reactivate_user(uuid, text) from public, anon;
grant execute on function public.ld_reactivate_user(uuid, text) to authenticated;

revoke all on function ld_private.sha(text) from public, anon, authenticated;
revoke all on function ld_private.make_link(uuid, int, uuid) from public, anon, authenticated;
revoke all on function ld_private.kill_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function ld_private.only_invited() from public, anon, authenticated;
