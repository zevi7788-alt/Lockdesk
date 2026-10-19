
-- =====================================================================
-- Technicians only see jobs assigned to them (enforced by the database)
-- and only the customers, invoices-free details, parts, timeline and
-- texts that belong to those jobs. Office staff are unaffected.
-- =====================================================================
create or replace function public.ld_is_tech() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text = 'technician' from public.profiles p where p.id = auth.uid()), false)
$$;
grant execute on function public.ld_is_tech() to anon, authenticated;

do $$
declare
  techcol text;
  t text;
begin
  select c into techcol from unnest(array['assigned_technician_id','technician_id','assigned_to','assigned_tech_id','tech_id','assigned_technician']) c
   where exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name=c)
   limit 1;
  if techcol is null then
    raise warning 'LockDesk: no technician column found on jobs; technician scoping skipped';
    return;
  end if;

  -- Helper: is this job assigned to the signed in technician?
  execute format($f$
    create or replace function public.ld_my_job(p_job text) returns boolean
    language sql stable security definer set search_path = public as $q$
      select exists (select 1 from public.jobs j where j.id::text = p_job and j.%I::text = auth.uid()::text)
    $q$;$f$, techcol);
  grant execute on function public.ld_my_job(text) to authenticated;

  drop policy if exists ld_tech_scope on public.jobs;
  execute format('create policy ld_tech_scope on public.jobs as restrictive for all to public
    using (not public.ld_is_tech() or %1$I::text = auth.uid()::text)
    with check (not public.ld_is_tech() or %1$I::text = auth.uid()::text)', techcol);

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='customer_id') then
    drop policy if exists ld_tech_scope on public.customers;
    execute format('create policy ld_tech_scope on public.customers as restrictive for all to public
      using (not public.ld_is_tech() or exists (select 1 from public.jobs j where j.customer_id::text = customers.id::text and j.%1$I::text = auth.uid()::text))
      with check (not public.ld_is_tech())', techcol);
  end if;

  foreach t in array array['job_events','payments','notifications','job_attachments','job_parts'] loop
    if to_regclass('public.' || t) is not null and exists (
      select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='job_id') then
      execute format('drop policy if exists ld_tech_scope on public.%I', t);
      execute format('create policy ld_tech_scope on public.%I as restrictive for all to public
        using (not public.ld_is_tech() or public.ld_my_job(job_id::text))
        with check (not public.ld_is_tech() or public.ld_my_job(job_id::text))', t);
    end if;
  end loop;
end $$;
