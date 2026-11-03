
-- ---------- Deny a sign up: delete the account and tell them ----------
-- Earlier versions blocked people with banned_until = 'infinity', which the
-- Supabase dashboard cannot read (it then fails to delete those users).
update auth.users set banned_until = '2999-01-01'::timestamptz where banned_until = 'infinity';

create or replace function public.ld_denied_email_html(p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.ld_company;
begin
  select * into c from public.ld_company limit 1;
  return format($h$<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#141a24">
<h2 style="margin:0 0 4px">%s</h2>
<hr style="border:0;border-top:1px solid #dde1e8;margin:16px 0">
<p style="font-size:16px">Hi %s,</p>
<p style="font-size:15px">Your request to access LockDesk was denied, and the account you created has been deleted.</p>
<p style="font-size:15px">LockDesk is only for %s staff. If you think this was a mistake, please contact the office.</p>
<p style="font-size:13px;color:#7b8597">%s</p></div>$h$,
    public.ld_html(coalesce(c.name, 'LockDesk')),
    public.ld_html(coalesce(nullif(p_name, ''), 'there')),
    public.ld_html(coalesce(c.name, 'company')),
    public.ld_html(concat_ws(' · ', c.phone, c.email)));
end $$;
revoke all on function public.ld_denied_email_html(text) from public, anon, authenticated;

-- Returns 'deleted' (account gone) or 'blocked' (kept because their name is on records).
create or replace function public.ld_deny_user(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text;
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can deny accounts.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot deny your own account.'; end if;
  if exists (select 1 from public.profiles where id = p_user and approved) then
    raise exception 'This person is already approved. Use Remove instead.';
  end if;
  select u.email::text, coalesce(p.full_name, '') into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id where u.id = p_user;
  if v_email is null then raise exception 'Account not found.'; end if;

  -- Sends only when email is set up; otherwise the app offers a ready made email instead.
  perform public.ld_send_email(v_email, 'Your LockDesk access request was denied', public.ld_denied_email_html(v_name));

  begin
    delete from auth.users where id = p_user;
    return 'deleted';
  exception when foreign_key_violation then
    update public.profiles set approved = false where id = p_user;
    update auth.users set banned_until = '2999-01-01'::timestamptz where id = p_user;
    return 'blocked';
  end;
end $$;
revoke all on function public.ld_deny_user(uuid) from public, anon;
grant execute on function public.ld_deny_user(uuid) to authenticated;
