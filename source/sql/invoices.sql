-- =====================================================================
-- LockDesk invoices (safe to run more than once; requires the security update)
--
--   * When a job is marked Completed, an invoice is created automatically.
--   * When the job is paid, the invoice is marked Paid automatically.
--   * Each invoice has a private link the customer can open (no login).
--   * Emails to customers go out automatically once email is connected
--     (Resend key + verified domain). Until then nothing is sent and the
--     app says so.
-- =====================================================================

-- ---------- Company details printed on invoices ----------
create table if not exists public.ld_company (
  id boolean primary key default true check (id),
  name text not null default 'Your Company',
  phone text, email text, address text, website text,
  tax_rate numeric(6,4) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  payment_instructions text,
  invoice_footer text default 'Thank you for your business.',
  app_url text,
  email_invoices boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.ld_company (id) values (true) on conflict do nothing;
alter table public.ld_company enable row level security;
drop policy if exists ld_company_read on public.ld_company;
drop policy if exists ld_company_write on public.ld_company;
create policy ld_company_read on public.ld_company for select to authenticated using (public.ld_is_approved());
create policy ld_company_write on public.ld_company for update to authenticated using (public.ld_is_owner()) with check (public.ld_is_owner());
revoke all on public.ld_company from anon;
grant select, update on public.ld_company to authenticated;

-- ---------- Office staff check ----------
create or replace function public.ld_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.role::text in ('owner', 'dispatcher')
                     from public.profiles p where p.id = auth.uid()), false)
$$;
grant execute on function public.ld_is_staff() to anon, authenticated;

-- ---------- Invoices ----------
create sequence if not exists public.ld_invoice_seq start 1001;

do $$
declare job_id_type text; cust_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into job_id_type
    from pg_attribute a where a.attrelid = 'public.jobs'::regclass and a.attname = 'id';
  select format_type(a.atttypid, a.atttypmod) into cust_id_type
    from pg_attribute a where a.attrelid = 'public.customers'::regclass and a.attname = 'id';
  execute format($f$
    create table if not exists public.invoices (
      id uuid primary key default gen_random_uuid(),
      number text not null unique default ('INV-' || nextval('public.ld_invoice_seq')),
      job_id %s not null unique references public.jobs(id) on delete cascade,
      customer_id %s references public.customers(id) on delete set null,
      status text not null default 'open' check (status in ('open', 'paid', 'void')),
      bill_to_name text, bill_to_email text, bill_to_phone text, bill_to_address text,
      job_number text, service text, service_address text, description text,
      lines jsonb not null default '[]'::jsonb,
      lines_edited boolean not null default false,
      subtotal numeric(10,2) not null default 0,
      tax_rate numeric(6,4) not null default 0,
      tax numeric(10,2) not null default 0,
      total numeric(10,2) not null default 0,
      issued_at timestamptz not null default now(),
      paid_at timestamptz,
      paid_amount numeric(10,2),
      paid_method text,
      paid_reference text,
      public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
      invoice_email_status text not null default 'not_sent',
      invoice_email_request bigint,
      invoice_emailed_at timestamptz,
      receipt_email_status text not null default 'not_sent',
      receipt_email_request bigint,
      receipt_emailed_at timestamptz,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )$f$, job_id_type, cust_id_type);
end $$;

create index if not exists invoices_customer_idx on public.invoices(customer_id);
create index if not exists invoices_status_idx on public.invoices(status);
alter table public.invoices enable row level security;
drop policy if exists ld_invoices_staff on public.invoices;
create policy ld_invoices_staff on public.invoices for all to authenticated
  using (public.ld_is_staff()) with check (public.ld_is_staff());
drop policy if exists ld_approved_only on public.invoices;
create policy ld_approved_only on public.invoices as restrictive for all to public
  using (public.ld_is_approved()) with check (public.ld_is_approved());
revoke all on public.invoices from anon;
grant select, update on public.invoices to authenticated;

-- ---------- Small helpers ----------
create or replace function public.ld_html(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create or replace function public.ld_money(n numeric) returns text
language sql immutable as $$ select '$' || to_char(coalesce(n, 0), 'FM999,999,990.00') $$;

-- First non-empty value among candidate keys of a row (works whatever your column names are)
create or replace function public.ld_pick(j jsonb, keys text[]) returns text
language plpgsql immutable as $$
declare k text;
begin
  foreach k in array keys loop
    if j ? k and nullif(j->>k, '') is not null then return j->>k; end if;
  end loop;
  return null;
end $$;

-- ---------- Email sending (via Resend) ----------
-- Returns the pg_net request id, or null when email isn't connected.
create or replace function public.ld_send_email(p_to text, p_subject text, p_html text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_key text; v_from text; v_id bigint;
begin
  select value into v_key from ld_private.settings where key = 'resend_api_key';
  select value into v_from from ld_private.settings where key = 'email_from';
  if v_key is null or v_from is null or p_to is null or position('@' in p_to) = 0 then return null; end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', v_from, 'to', jsonb_build_array(p_to), 'subject', p_subject, 'html', p_html)
  ) into v_id;
  return v_id;
exception when others then
  raise warning 'LockDesk email failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.ld_send_email(text, text, text) from public, anon, authenticated;

create or replace function public.ld_invoice_email_html(inv public.invoices, paid boolean) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.ld_company; link text; rows text := ''; l jsonb;
begin
  select * into c from public.ld_company limit 1;
  link := coalesce(nullif(c.app_url, ''), '') || '#/i/' || inv.public_token;
  for l in select * from jsonb_array_elements(inv.lines) loop
    rows := rows || format('<tr><td style="padding:6px 0">%s</td><td style="padding:6px 0;text-align:right">%s</td></tr>',
      public.ld_html(l->>'description'), public.ld_money((l->>'amount')::numeric * coalesce((l->>'qty')::numeric, 1)));
  end loop;
  return format($h$<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#141a24">
<h2 style="margin:0 0 4px">%s</h2>
<div style="color:#4a5466;font-size:14px">%s</div>
<hr style="border:0;border-top:1px solid #dde1e8;margin:16px 0">
<p style="font-size:16px">%s</p>
<p style="font-size:14px;color:#4a5466">Invoice <b>%s</b> · Job %s · %s</p>
<table style="width:100%%;font-size:14px;border-collapse:collapse">%s
<tr><td style="padding:8px 0;border-top:1px solid #dde1e8"><b>Total</b></td><td style="padding:8px 0;border-top:1px solid #dde1e8;text-align:right"><b>%s</b></td></tr></table>
%s
<p><a href="%s" style="display:inline-block;background:#1b2433;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">View %s</a></p>
<p style="font-size:13px;color:#7b8597">%s</p></div>$h$,
    public.ld_html(c.name),
    public.ld_html(concat_ws(' · ', c.phone, c.email, c.address)),
    case when paid then 'Thank you. Your payment of <b>' || public.ld_money(coalesce(inv.paid_amount, inv.total)) || '</b> has been received.'
         else 'Hi ' || public.ld_html(coalesce(inv.bill_to_name, 'there')) || ', your locksmith service is complete. Your balance is <b>' || public.ld_money(inv.total) || '</b>.' end,
    public.ld_html(inv.number), public.ld_html(inv.job_number), public.ld_html(inv.service),
    rows, public.ld_money(inv.total),
    case when paid then '' else coalesce('<p style="font-size:14px">' || public.ld_html(c.payment_instructions) || '</p>', '') end,
    link, case when paid then 'receipt' else 'invoice' end,
    public.ld_html(c.invoice_footer));
end $$;

create or replace function public.ld_email_invoice(p_invoice uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; c public.ld_company; v_id bigint; subj text;
begin
  select * into inv from public.invoices where id = p_invoice;
  select * into c from public.ld_company limit 1;
  if inv.id is null or not coalesce(c.email_invoices, false) then return; end if;
  if inv.bill_to_email is null then
    if p_paid then update public.invoices set receipt_email_status = 'no_email' where id = inv.id;
    else update public.invoices set invoice_email_status = 'no_email' where id = inv.id; end if;
    return;
  end if;
  subj := case when p_paid then c.name || ': payment received, ' || inv.number else c.name || ': invoice ' || inv.number end;
  v_id := public.ld_send_email(inv.bill_to_email, subj, public.ld_invoice_email_html(inv, p_paid));
  if p_paid then
    update public.invoices set receipt_email_request = v_id, receipt_emailed_at = now(),
      receipt_email_status = case when v_id is null then 'failed' else 'sending' end where id = inv.id;
  else
    update public.invoices set invoice_email_request = v_id, invoice_emailed_at = now(),
      invoice_email_status = case when v_id is null then 'failed' else 'sending' end where id = inv.id;
  end if;
end $$;
revoke all on function public.ld_email_invoice(uuid, boolean) from public, anon, authenticated;

-- Check what actually happened to sent emails (Resend's real answer)
create or replace function public.ld_refresh_email_status() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ld_is_staff() then return; end if;
  begin
    update public.invoices i set invoice_email_status = case when r.status_code between 200 and 299 then 'sent' else 'failed' end
      from net._http_response r where r.id = i.invoice_email_request and i.invoice_email_status = 'sending';
    update public.invoices i set receipt_email_status = case when r.status_code between 200 and 299 then 'sent' else 'failed' end
      from net._http_response r where r.id = i.receipt_email_request and i.receipt_email_status = 'sending';
  exception when others then null;
  end;
end $$;
grant execute on function public.ld_refresh_email_status() to authenticated;

-- ---------- Build / refresh an invoice from its job ----------
create or replace function public.ld_upsert_invoice_for_job(p_job jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.ld_company;
  cust jsonb;
  v_job_id text := p_job->>'id';
  v_cust text := public.ld_pick(p_job, array['customer_id']);
  v_final numeric := nullif(public.ld_pick(p_job, array['final_amount','final_price']), '')::numeric;
  v_cents numeric := nullif(public.ld_pick(p_job, array['final_amount_cents','final_cents']), '')::numeric;
  v_service text := coalesce(public.ld_pick(p_job, array['service_type','service','job_type']), 'Locksmith service');
  v_num text := public.ld_pick(p_job, array['job_number','job_no','number','reference']);
  v_addr text;
  v_lines jsonb;
  inv public.invoices;
  v_id uuid;
begin
  if v_final is null and v_cents is not null then v_final := v_cents / 100; end if;
  if v_final is null then return null; end if;
  select * into c from public.ld_company limit 1;
  if v_cust is not null then
    execute 'select to_jsonb(x) from public.customers x where x.id::text = $1' into cust using v_cust;
  end if;
  v_addr := concat_ws(', ',
    coalesce(public.ld_pick(p_job, array['address','service_address','address_line1','street_address','street']),
             public.ld_pick(cust, array['address','address_line1','street_address','street','address1'])),
    coalesce(public.ld_pick(p_job, array['city','service_city']), public.ld_pick(cust, array['city'])),
    trim(concat_ws(' ', coalesce(public.ld_pick(p_job, array['state','service_state']), public.ld_pick(cust, array['state'])),
                        coalesce(public.ld_pick(p_job, array['zip','zip_code','postal_code','service_zip']), public.ld_pick(cust, array['zip','zip_code','postal_code','zipcode'])))));
  if v_num ~ '^\d+$' then v_num := 'LD-' || v_num; end if;
  v_lines := jsonb_build_array(jsonb_build_object('description', v_service, 'qty', 1, 'amount', v_final));

  select * into inv from public.invoices where job_id::text = v_job_id;
  if inv.id is null then
    execute format('insert into public.invoices (job_id, customer_id, bill_to_name, bill_to_email, bill_to_phone, bill_to_address,
                      job_number, service, service_address, description, lines, subtotal, tax_rate, tax, total)
                    values ($1::%s, $2::%s, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, round($12 * $13, 2), $12 + round($12 * $13, 2))
                    returning id',
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.jobs'::regclass and a.attname = 'id'),
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.customers'::regclass and a.attname = 'id'))
    into v_id
    using v_job_id, v_cust,
      coalesce(public.ld_pick(p_job, array['customer_name']), public.ld_pick(cust, array['full_name','name','customer_name']),
               trim(concat_ws(' ', public.ld_pick(cust, array['first_name']), public.ld_pick(cust, array['last_name'])))),
      lower(coalesce(public.ld_pick(p_job, array['customer_email']), public.ld_pick(cust, array['email']))),
      coalesce(public.ld_pick(p_job, array['customer_phone']), public.ld_pick(cust, array['phone','phone_number','mobile'])),
      nullif(v_addr, ''), v_num, v_service, nullif(v_addr, ''),
      public.ld_pick(p_job, array['description','problem_description','details']),
      v_lines, v_final, coalesce(c.tax_rate, 0);
    perform public.ld_email_invoice(v_id, false);
    return v_id;
  elsif inv.status = 'open' and not inv.lines_edited then
    update public.invoices
       set lines = v_lines, subtotal = v_final, tax = round(v_final * tax_rate, 2),
           total = v_final + round(v_final * tax_rate, 2), service = v_service, updated_at = now()
     where id = inv.id;
  end if;
  return inv.id;
end $$;
revoke all on function public.ld_upsert_invoice_for_job(jsonb) from public, anon, authenticated;

-- Mark paid (idempotent) and send the paid receipt
create or replace function public.ld_mark_invoice_paid(p_job_id text, p_amount numeric, p_method text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_job jsonb;
begin
  select * into inv from public.invoices where job_id::text = p_job_id;
  if inv.id is null then
    -- Paid before an invoice existed: create it now
    execute 'select to_jsonb(j) from public.jobs j where j.id::text = $1' into v_job using p_job_id;
    if v_job is not null then perform public.ld_upsert_invoice_for_job(v_job); end if;
    select * into inv from public.invoices where job_id::text = p_job_id;
  end if;
  if inv.id is null or inv.status = 'paid' then return; end if;
  update public.invoices
     set status = 'paid', paid_at = now(), paid_amount = coalesce(p_amount, inv.total),
         paid_method = coalesce(p_method, paid_method), paid_reference = coalesce(p_ref, paid_reference), updated_at = now()
   where id = inv.id;
  perform public.ld_email_invoice(inv.id, true);
end $$;
revoke all on function public.ld_mark_invoice_paid(text, numeric, text, text) from public, anon, authenticated;

-- ---------- Triggers ----------
create or replace function public.ld_jobs_invoice_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare n jsonb := to_jsonb(new); o jsonb; st text; pay text;
begin
  st := n->>'status';
  if st = 'completed' then
    perform public.ld_upsert_invoice_for_job(n);
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if o->>'status' = 'completed' and st = 'cancelled' then
      update public.invoices set status = 'void', updated_at = now() where job_id::text = n->>'id' and status = 'open';
    end if;
  end if;
  pay := n->>'payment_status';
  if pay = 'paid' and (tg_op = 'INSERT' or (to_jsonb(old)->>'payment_status') is distinct from 'paid') then
    perform public.ld_mark_invoice_paid(n->>'id', null, n->>'payment_method', null);
  end if;
  return new;
end $$;

drop trigger if exists zz_ld_jobs_invoice on public.jobs;
create trigger zz_ld_jobs_invoice after insert or update on public.jobs
  for each row execute function public.ld_jobs_invoice_trigger();

do $$
begin
  if to_regclass('public.payments') is not null then
    execute $t$
      create or replace function public.ld_payments_invoice_trigger() returns trigger
      language plpgsql security definer set search_path = public as $f$
      declare n jsonb := to_jsonb(new);
      begin
        if coalesce(public.ld_pick(n, array['status','payment_status']), 'paid') = 'paid' then
          perform public.ld_mark_invoice_paid(
            n->>'job_id',
            nullif(public.ld_pick(n, array['amount','amount_paid']), '')::numeric,
            public.ld_pick(n, array['method','payment_method']),
            public.ld_pick(n, array['processor_transaction_id','processor_reference','processor_ref','transaction_id','reference_id','reference']));
        end if;
        return new;
      end $f$;
    $t$;
    execute 'drop trigger if exists zz_ld_payments_invoice on public.payments';
    execute 'create trigger zz_ld_payments_invoice after insert on public.payments for each row execute function public.ld_payments_invoice_trigger()';
  end if;
end $$;

-- ---------- Staff actions ----------
create or replace function public.ld_save_invoice_lines(p_invoice uuid, p_lines jsonb, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub numeric;
begin
  if not public.ld_is_staff() then raise exception 'Only office staff can edit invoices.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one line.'; end if;
  select coalesce(sum(round((l->>'amount')::numeric * coalesce((l->>'qty')::numeric, 1), 2)), 0) into v_sub
    from jsonb_array_elements(p_lines) l;
  update public.invoices
     set lines = p_lines, lines_edited = true, notes = p_notes, subtotal = v_sub,
         tax = round(v_sub * tax_rate, 2), total = v_sub + round(v_sub * tax_rate, 2), updated_at = now()
   where id = p_invoice and status = 'open';
  if not found then raise exception 'Only open invoices can be edited.'; end if;
end $$;
revoke all on function public.ld_save_invoice_lines(uuid, jsonb, text) from public, anon;
grant execute on function public.ld_save_invoice_lines(uuid, jsonb, text) to authenticated;

create or replace function public.ld_resend_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  if not public.ld_is_staff() then raise exception 'Only office staff can send invoices.'; end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then raise exception 'Invoice not found.'; end if;
  if not coalesce((select email_invoices from public.ld_company limit 1), false) then
    raise exception 'Email is not connected yet. Use Copy link or Text link instead.';
  end if;
  perform public.ld_email_invoice(inv.id, inv.status = 'paid');
end $$;
revoke all on function public.ld_resend_invoice(uuid) from public, anon;
grant execute on function public.ld_resend_invoice(uuid) to authenticated;

-- Create invoices for jobs that were completed before this update
create or replace function public.ld_backfill_invoices() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if auth.uid() is not null and not public.ld_is_staff() then raise exception 'Not allowed.'; end if;
  for r in execute 'select to_jsonb(j) as j from public.jobs j where j.status::text = ''completed''' loop
    if not exists (select 1 from public.invoices i where i.job_id::text = r.j->>'id') then
      perform public.ld_upsert_invoice_for_job(r.j);
      n := n + 1;
      if r.j->>'payment_status' = 'paid' then
        update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()), paid_amount = total,
               paid_method = r.j->>'payment_method'
         where job_id::text = r.j->>'id';
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ld_backfill_invoices() from public, anon;
grant execute on function public.ld_backfill_invoices() to authenticated;

-- ---------- The customer's private invoice link (no login) ----------
create or replace function public.ld_public_invoice(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare inv public.invoices; c public.ld_company;
begin
  if p_token is null or length(p_token) < 24 then return null; end if;
  select * into inv from public.invoices where public_token = p_token and status <> 'void';
  if inv.id is null then return null; end if;
  select * into c from public.ld_company limit 1;
  return jsonb_build_object(
    'number', inv.number, 'status', inv.status, 'issued_at', inv.issued_at, 'paid_at', inv.paid_at,
    'paid_amount', inv.paid_amount, 'paid_method', inv.paid_method,
    'bill_to_name', inv.bill_to_name, 'bill_to_address', inv.bill_to_address,
    'job_number', inv.job_number, 'service', inv.service, 'service_address', inv.service_address,
    'lines', inv.lines, 'subtotal', inv.subtotal, 'tax_rate', inv.tax_rate, 'tax', inv.tax, 'total', inv.total,
    'notes', inv.notes,
    'company', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address,
                                  'website', c.website, 'payment_instructions', c.payment_instructions, 'footer', c.invoice_footer));
end $$;
revoke all on function public.ld_public_invoice(text) from public;
grant execute on function public.ld_public_invoice(text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.invoices;
exception when duplicate_object or undefined_object then null;
end $$;

select public.ld_backfill_invoices();

-- Lets the app know whether email sending is configured (without revealing the key)
create or replace function public.ld_email_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select public.ld_is_staff()
     and exists (select 1 from ld_private.settings where key = 'resend_api_key' and value <> '')
     and exists (select 1 from ld_private.settings where key = 'email_from' and value <> '')
$$;
revoke all on function public.ld_email_ready() from public, anon;
grant execute on function public.ld_email_ready() to authenticated;
