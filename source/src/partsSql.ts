// One time database update that adds parts tracking.
// It only ADDS a table. It does not touch existing tables, data or policies.
// Access is tied to the existing jobs security: a person can see and edit a
// job's parts only if your existing jobs rules already let them see that job.
export const PARTS_SQL = `-- LockDesk: add parts ordering (safe to run more than once)
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
`
