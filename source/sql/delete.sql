
-- =====================================================================
-- Delete a job (owner only): removes the job and everything attached to
-- it (invoice, payments, parts, timeline, texts, attachments).
-- =====================================================================
create or replace function public.ld_delete_job(p_job text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can delete jobs.'; end if;
  if not exists (select 1 from public.jobs j where j.id::text = p_job) then raise exception 'Job not found.'; end if;
  foreach t in array array['payments','invoices','job_parts','job_events','notifications','job_attachments'] loop
    if to_regclass('public.' || t) is not null and exists (
      select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'job_id') then
      execute format('delete from public.%I where job_id::text = $1', t) using p_job;
    end if;
  end loop;
  delete from public.jobs j where j.id::text = p_job;
end $$;
revoke all on function public.ld_delete_job(text) from public, anon;
grant execute on function public.ld_delete_job(text) to authenticated;

-- Delete a customer and all of their jobs (owner only)
create or replace function public.ld_delete_customer(p_customer text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not public.ld_is_owner() then raise exception 'Only the owner can delete customers.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'customer_id') then
    for r in execute 'select id::text as id from public.jobs where customer_id::text = $1' using p_customer loop
      perform public.ld_delete_job(r.id);
      n := n + 1;
    end loop;
  end if;
  if to_regclass('public.notifications') is not null and exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'customer_id') then
    execute 'delete from public.notifications where customer_id::text = $1' using p_customer;
  end if;
  if to_regclass('public.invoices') is not null then
    delete from public.invoices where customer_id::text = p_customer;
  end if;
  delete from public.customers c where c.id::text = p_customer;
  return n;
end $$;
revoke all on function public.ld_delete_customer(text) from public, anon;
grant execute on function public.ld_delete_customer(text) to authenticated;
