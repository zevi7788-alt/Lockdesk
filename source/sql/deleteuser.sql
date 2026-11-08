
-- ---------- Owner: delete an account from Team ----------
alter table public.profiles add column if not exists archived boolean not null default false;

-- Returns 'deleted' (gone completely) or 'archived' (their name is on past jobs,
-- so the record stays for history, but the login and email are erased for good).
create or replace function public.ld_delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can delete accounts.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account here.'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Account not found.'; end if;
  perform public.ld_deactivate_user(p_user);
  begin
    delete from auth.users where id = p_user;
    return 'deleted';
  exception when foreign_key_violation then
    update public.profiles set archived = true, approved = false where id = p_user;
    update auth.users
       set email = 'deleted+' || replace(p_user::text, '-', '') || '@deleted.invalid',
           encrypted_password = null,
           banned_until = '2999-01-01'::timestamptz
     where id = p_user;
    delete from auth.identities where user_id = p_user;
    return 'archived';
  end;
end $$;
revoke all on function public.ld_delete_user(uuid) from public, anon;
grant execute on function public.ld_delete_user(uuid) to authenticated;
