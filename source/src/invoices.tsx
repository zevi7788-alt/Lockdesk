import React, { useEffect, useMemo, useState } from 'react'
import { sb, schema, errText } from './db'
import { useStore } from './store'
import { Empty, Field, KV, Modal, go } from './ui'
import { SetupScript } from './setup'
import { Job, PAY_LABEL, fmtDateTime, money, titleCase } from './model'

// ---------------- Data ----------------

export type InvoiceLine = { description: string; qty: number; amount: number }
export type Invoice = {
  id: string; number: string; jobId: string; customerId: string; status: 'open' | 'paid' | 'void'
  billToName: string; billToEmail: string; billToPhone: string; billToAddress: string
  jobNumber: string; service: string; serviceAddress: string
  lines: InvoiceLine[]; linesEdited: boolean; subtotal: number; taxRate: number; tax: number; total: number
  issuedAt: Date | null; paidAt: Date | null; paidAmount: number | null; paidMethod: string; paidReference: string
  token: string; invoiceEmail: string; invoiceEmailedAt: Date | null; receiptEmail: string; receiptEmailedAt: Date | null; notes: string
}
export type Company = {
  name: string; phone: string; email: string; address: string; website: string; taxRate: number
  paymentInstructions: string; footer: string; appUrl: string; emailInvoices: boolean
}

const s = (v: any) => (v === null || v === undefined ? '' : String(v))
const dt = (v: any) => (v ? new Date(v) : null)
const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v))

export const invoicesEnabled = () => schema.tables.invoices === true && schema.tables.ld_company === true

function toInvoice(r: any): Invoice {
  return {
    id: s(r.id), number: s(r.number), jobId: s(r.job_id), customerId: s(r.customer_id), status: r.status,
    billToName: s(r.bill_to_name), billToEmail: s(r.bill_to_email), billToPhone: s(r.bill_to_phone), billToAddress: s(r.bill_to_address),
    jobNumber: s(r.job_number), service: s(r.service), serviceAddress: s(r.service_address),
    lines: Array.isArray(r.lines) ? r.lines.map((l: any) => ({ description: s(l.description), qty: num(l.qty) || 1, amount: num(l.amount) })) : [],
    linesEdited: !!r.lines_edited, subtotal: num(r.subtotal), taxRate: num(r.tax_rate), tax: num(r.tax), total: num(r.total),
    issuedAt: dt(r.issued_at), paidAt: dt(r.paid_at), paidAmount: r.paid_amount === null || r.paid_amount === undefined ? null : num(r.paid_amount),
    paidMethod: s(r.paid_method), paidReference: s(r.paid_reference), token: s(r.public_token),
    invoiceEmail: s(r.invoice_email_status), invoiceEmailedAt: dt(r.invoice_emailed_at),
    receiptEmail: s(r.receipt_email_status), receiptEmailedAt: dt(r.receipt_emailed_at), notes: s(r.notes),
  }
}
function toCompany(r: any): Company {
  return {
    name: s(r?.name), phone: s(r?.phone), email: s(r?.email), address: s(r?.address), website: s(r?.website),
    taxRate: num(r?.tax_rate), paymentInstructions: s(r?.payment_instructions), footer: s(r?.invoice_footer),
    appUrl: s(r?.app_url), emailInvoices: !!r?.email_invoices,
  }
}

export async function loadInvoices(): Promise<Invoice[]> {
  if (!invoicesEnabled()) return []
  try { await sb.rpc('ld_refresh_email_status') } catch {}
  const { data, error } = await sb.from('invoices').select('*').order('issued_at', { ascending: false }).limit(5000)
  if (error || !data) return []
  return data.map(toInvoice)
}
export async function loadCompany(): Promise<{ company: Company | null; emailReady: boolean }> {
  if (!invoicesEnabled()) return { company: null, emailReady: false }
  const [{ data }, ready] = await Promise.all([
    sb.from('ld_company').select('*').maybeSingle(),
    sb.rpc('ld_email_ready').then((r: any) => !!r.data, () => false),
  ])
  return { company: data ? toCompany(data) : null, emailReady: ready }
}
export async function saveCompany(c: Company) {
  const { error } = await sb.from('ld_company').update({
    name: c.name.trim() || 'Your Company', phone: c.phone.trim() || null, email: c.email.trim() || null,
    address: c.address.trim() || null, website: c.website.trim() || null, tax_rate: c.taxRate,
    payment_instructions: c.paymentInstructions.trim() || null, invoice_footer: c.footer.trim() || null,
    app_url: appUrl(), email_invoices: c.emailInvoices, updated_at: new Date().toISOString(),
  }).eq('id', true)
  if (error) throw new Error(errText(error))
}
export const appUrl = () => location.origin + location.pathname
export const invoiceLink = (inv: Invoice) => appUrl() + '#/i/' + inv.token

async function rpc(fn: string, args?: any) {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(errText(error))
  return data
}
export const saveInvoiceLines = (id: string, lines: InvoiceLine[], notes: string) => rpc('ld_save_invoice_lines', { p_invoice: id, p_lines: lines, p_notes: notes || null })
export const resendInvoice = (id: string) => rpc('ld_resend_invoice', { p_invoice: id })

// ---------------- The invoice document ----------------

type DocData = {
  number: string; status: string; issuedAt: Date | null; paidAt: Date | null; paidAmount: number | null; paidMethod: string
  billToName: string; billToAddress: string; jobNumber: string; service: string; serviceAddress: string
  lines: InvoiceLine[]; subtotal: number; taxRate: number; tax: number; total: number; notes: string
  company: { name: string; phone: string; email: string; address: string; website: string; paymentInstructions: string; footer: string }
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')

export function InvoiceDoc({ d }: { d: DocData }) {
  const paid = d.status === 'paid'
  return (
    <article className="invoice-doc">
      {paid ? <div className="paid-stamp">Paid</div> : null}
      <header className="inv-head">
        <div>
          <div className="inv-co">{d.company.name}</div>
          <div className="inv-co-lines">
            {d.company.address ? <div>{d.company.address}</div> : null}
            {[d.company.phone, d.company.email].filter(Boolean).length ? <div>{[d.company.phone, d.company.email].filter(Boolean).join(' · ')}</div> : null}
            {d.company.website ? <div>{d.company.website}</div> : null}
          </div>
        </div>
        <div className="inv-meta">
          <div className="inv-title">{paid ? 'Receipt' : 'Invoice'}</div>
          <div className="mono">{d.number}</div>
          <div>{fmtDate(d.issuedAt)}</div>
        </div>
      </header>
      <section className="inv-parties">
        <div><span className="inv-label">Bill to</span><div>{d.billToName || 'Customer'}</div>{d.billToAddress ? <div>{d.billToAddress}</div> : null}</div>
        <div><span className="inv-label">Service</span><div>{d.service}</div>{d.serviceAddress && d.serviceAddress !== d.billToAddress ? <div>{d.serviceAddress}</div> : null}{d.jobNumber ? <div className="mono small">Job {d.jobNumber}</div> : null}</div>
      </section>
      <table className="inv-lines">
        <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i}><td>{l.description}</td><td className="r mono">{l.qty}</td><td className="r mono">{money(l.amount)}</td><td className="r mono">{money(Math.round(l.amount * l.qty * 100) / 100)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="inv-totals">
        <div><span>Subtotal</span><span className="mono">{money(d.subtotal)}</span></div>
        {d.tax > 0 ? <div><span>Tax ({(d.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')}%)</span><span className="mono">{money(d.tax)}</span></div> : null}
        <div className="inv-total"><span>Total</span><span className="mono">{money(d.total)}</span></div>
        {paid ? <div className="inv-paid"><span>Paid {fmtDate(d.paidAt)}{d.paidMethod ? ` · ${PAY_LABEL[d.paidMethod] || titleCase(d.paidMethod)}` : ''}</span><span className="mono">{money(d.paidAmount ?? d.total)}</span></div> : null}
        <div className="inv-due"><span>{paid ? 'Balance' : 'Balance due'}</span><span className="mono">{money(paid ? Math.max(0, d.total - (d.paidAmount ?? d.total)) : d.total)}</span></div>
      </div>
      {d.notes ? <p className="inv-notes">{d.notes}</p> : null}
      {!paid && d.company.paymentInstructions ? <div className="inv-pay"><span className="inv-label">How to pay</span><p>{d.company.paymentInstructions}</p></div> : null}
      {d.company.footer ? <footer className="inv-foot">{d.company.footer}</footer> : null}
    </article>
  )
}

function docFromInvoice(inv: Invoice, c: Company | null): DocData {
  return {
    ...inv,
    company: {
      name: c?.name || 'Your Company', phone: c?.phone || '', email: c?.email || '', address: c?.address || '',
      website: c?.website || '', paymentInstructions: c?.paymentInstructions || '', footer: c?.footer || '',
    },
  }
}

// Public page the customer opens from the link (no login)
export function PublicInvoice({ token }: { token: string }) {
  const [state, setState] = useState<'loading' | 'missing' | DocData>('loading')
  useEffect(() => {
    sb.rpc('ld_public_invoice', { p_token: token }).then(({ data, error }: any) => {
      if (error || !data) { setState('missing'); return }
      const c = data.company || {}
      setState({
        number: s(data.number), status: s(data.status), issuedAt: dt(data.issued_at), paidAt: dt(data.paid_at),
        paidAmount: data.paid_amount === null ? null : num(data.paid_amount), paidMethod: s(data.paid_method),
        billToName: s(data.bill_to_name), billToAddress: s(data.bill_to_address), jobNumber: s(data.job_number),
        service: s(data.service), serviceAddress: s(data.service_address),
        lines: (data.lines || []).map((l: any) => ({ description: s(l.description), qty: num(l.qty) || 1, amount: num(l.amount) })),
        subtotal: num(data.subtotal), taxRate: num(data.tax_rate), tax: num(data.tax), total: num(data.total), notes: s(data.notes),
        company: { name: s(c.name), phone: s(c.phone), email: s(c.email), address: s(c.address), website: s(c.website), paymentInstructions: s(c.payment_instructions), footer: s(c.footer) },
      })
    })
  }, [token])
  useEffect(() => { if (typeof state === 'object') document.title = `${state.status === 'paid' ? 'Receipt' : 'Invoice'} ${state.number} · ${state.company.name}` }, [state])
  if (state === 'loading') return <div className="splash"><span>Loading invoice…</span></div>
  if (state === 'missing') return <div className="login"><div className="login-card"><h2 className="pending-h">Invoice not found</h2><p>This link may be mistyped or the invoice was cancelled. Please contact the company that sent it.</p></div></div>
  return (
    <div className="inv-page">
      <InvoiceDoc d={state} />
      <div className="inv-actions no-print"><button className="btn" onClick={() => window.print()}>Print or save as PDF</button></div>
    </div>
  )
}

// ---------------- Staff screens ----------------

const emailLabel = (st: string, at: Date | null) =>
  st === 'sent' ? `Emailed ${at ? fmtDateTime(at) : ''}` : st === 'sending' ? 'Sending email…' : st === 'failed' ? 'Email failed' : st === 'no_email' ? 'No customer email on file' : 'Not emailed'

function InvoiceStatus({ inv }: { inv: Invoice }) {
  return <span className={'badge inv-' + inv.status}>{inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Void' : 'Open'}</span>
}

function ShareButtons({ inv }: { inv: Invoice }) {
  const { toast, company, emailReady, reload } = useStore()
  const link = invoiceLink(inv)
  const text = inv.status === 'paid'
    ? `${company?.name || 'Thank you'}: your payment of ${money(inv.paidAmount ?? inv.total)} was received. Receipt: ${link}`
    : `${company?.name || 'Your locksmith'}: invoice ${inv.number} for ${money(inv.total)}. View it here: ${link}`
  const sms = 'sms:' + inv.billToPhone.replace(/[^\d+]/g, '') + (/iphone|ipad|ipod|mac/i.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(text)
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Invoice link copied') } catch { toast('Could not copy. Long press the View link instead.', 'err') } }
  return (
    <div className="inv-share">
      <a className="btn" href={'#/invoices/' + inv.id}>View</a>
      <button className="btn" onClick={copy}>Copy link</button>
      {inv.billToPhone ? <a className="btn" href={sms}>Text link</a> : null}
      {emailReady && company?.emailInvoices && inv.billToEmail ? (
        <button className="btn" onClick={async () => { try { await resendInvoice(inv.id); toast('Email sent'); reload() } catch (e: any) { toast(e.message, 'err') } }}>Email again</button>
      ) : null}
    </div>
  )
}

export function JobInvoicePanel({ job }: { job: Job }) {
  const { invoices, company, emailReady } = useStore()
  if (!invoicesEnabled()) return <p className="muted small">Invoices need the latest database update. Open <a href="#/system">System check</a>.</p>
  const inv = invoices.find((i) => i.jobId === job.id)
  if (!inv) return <p className="muted small">{job.status === 'completed' ? 'Invoice is being created…' : 'An invoice is created automatically when this job is completed.'}</p>
  const emailOn = emailReady && company?.emailInvoices
  return (
    <div className="inv-panel">
      <div className="inv-panel-top"><span className="mono">{inv.number}</span><InvoiceStatus inv={inv} /><span className="mono inv-panel-total">{money(inv.total)}</span></div>
      <div className="sub">
        {emailOn ? (inv.status === 'paid' ? `Receipt: ${emailLabel(inv.receiptEmail, inv.receiptEmailedAt)}` : `Invoice: ${emailLabel(inv.invoiceEmail, inv.invoiceEmailedAt)}`)
          : 'Automatic email is off until email is connected. Text or copy the link for now.'}
      </div>
      <ShareButtons inv={inv} />
    </div>
  )
}

export function CustomerInvoices({ customerId }: { customerId: string }) {
  const { invoices } = useStore()
  if (!invoicesEnabled()) return null
  const list = invoices.filter((i) => i.customerId === customerId)
  return (
    <div className="panel">
      <h3>Invoices</h3>
      {list.length === 0 ? <p className="muted small">No invoices yet.</p> : (
        <div className="list compact">
          {list.map((i) => (
            <a key={i.id} className="list-row" href={'#/invoices/' + i.id}>
              <div><span className="mono">{i.number}</span> {i.service}<div className="sub">{i.issuedAt ? fmtDateTime(i.issuedAt) : ''}</div></div>
              <div className="r"><InvoiceStatus inv={i} /><div className="sub mono">{money(i.total)}</div></div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function InvoicesPage({ filter }: { filter?: string }) {
  const { invoices } = useStore()
  const [q, setQ] = useState('')
  const f = filter || 'open'
  const list = useMemo(() => invoices
    .filter((i) => f === 'all' || i.status === f)
    .filter((i) => !q.trim() || [i.number, i.billToName, i.billToEmail, i.billToPhone, i.service, i.jobNumber].join(' ').toLowerCase().includes(q.trim().toLowerCase())),
  [invoices, f, q])
  if (!invoicesEnabled()) {
    return (
      <div className="page">
        <div className="page-head"><h1>Invoices</h1></div>
        <div className="panel warn-panel"><h3>Database update needed</h3><SetupScript intro="Invoices need a one time update. It adds invoices and is safe to run again even if you ran an earlier update." /></div>
      </div>
    )
  }
  const openTotal = invoices.filter((i) => i.status === 'open').reduce((a, i) => a + i.total, 0)
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0)
  const paidMonth = invoices.filter((i) => i.status === 'paid' && i.paidAt && i.paidAt >= month).reduce((a, i) => a + (i.paidAmount ?? i.total), 0)
  return (
    <div className="page">
      <div className="page-head"><h1>Invoices</h1><a className="btn" href="#/settings">Invoice settings</a></div>
      <div className="stats">
        <div className="stat"><span className="stat-v mono">{money(openTotal)}</span><span className="stat-k">Open balance</span></div>
        <div className="stat"><span className="stat-v mono">{money(paidMonth)}</span><span className="stat-k">Paid this month</span></div>
        <div className="stat"><span className="stat-v mono">{invoices.length}</span><span className="stat-k">All invoices</span></div>
      </div>
      <div className="toolbar">
        <input id="inv-search" className="search" placeholder="Search invoice #, customer, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {[['open', 'Open'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']].map(([k, l]) => (
            <a key={k} href={'#/invoices/filter/' + k} className={'chip' + (f === k ? ' on' : '')}>{l} <span className="mono">{k === 'all' ? invoices.length : invoices.filter((i) => i.status === k).length}</span></a>
          ))}
        </div>
      </div>
      {list.length === 0 ? <Empty>{invoices.length ? 'No invoices match.' : 'Invoices appear here automatically when jobs are completed.'}</Empty> : (
        <div className="list">
          {list.map((i) => (
            <a key={i.id} className="list-row" href={'#/invoices/' + i.id}>
              <div><span className="mono">{i.number}</span> · <strong>{i.billToName}</strong><div className="sub">{i.service}{i.issuedAt ? ` · ${fmtDateTime(i.issuedAt)}` : ''}</div></div>
              <div className="r"><InvoiceStatus inv={i} /><div className="sub mono">{money(i.total)}</div></div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function EditLines({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { toast, reload } = useStore()
  const [lines, setLines] = useState(inv.lines.map((l) => ({ description: l.description, qty: String(l.qty), amount: String(l.amount) })))
  const [notes, setNotes] = useState(inv.notes)
  const [err, setErr] = useState('')
  const set = (i: number, k: 'description' | 'qty' | 'amount', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const sub = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.amount) || 0), 0)
  return (
    <Modal title={`Edit ${inv.number}`} onClose={onClose}>
      {lines.map((l, i) => (
        <div key={i} className="line-edit">
          <input id={'le-d' + i} placeholder="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} />
          <input id={'le-q' + i} className="mono" inputMode="numeric" placeholder="Qty" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
          <input id={'le-a' + i} className="mono" inputMode="decimal" placeholder="Price" value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
          <button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>
        </div>
      ))}
      <button className="btn" onClick={() => setLines([...lines, { description: '', qty: '1', amount: '' }])}>+ Add line</button>
      <Field label="Note on invoice"><textarea id="le-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="inv-totals"><div className="inv-total"><span>Subtotal</span><span className="mono">{money(sub)}</span></div></div>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full big" onClick={async () => {
        try {
          const clean = lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, amount: Number(l.amount) || 0 }))
          await saveInvoiceLines(inv.id, clean, notes); toast('Invoice updated'); await reload(); onClose()
        } catch (e: any) { setErr(e.message) }
      }}>Save invoice</button>
    </Modal>
  )
}

export function InvoiceDetail({ id }: { id: string }) {
  const { invoices, company, jobs } = useStore()
  const inv = invoices.find((i) => i.id === id)
  const [editing, setEditing] = useState(false)
  if (!inv) return <div className="page"><Empty>Invoice not found.</Empty></div>
  const job = jobs.find((j) => j.id === inv.jobId)
  return (
    <div className="page">
      <div className="page-head no-print">
        <div><div className="crumbs"><a href="#/invoices">Invoices</a> / <span className="mono">{inv.number}</span></div><h1>{inv.billToName || inv.number}</h1></div>
        <div className="head-actions">
          {job ? <a className="btn" href={'#/jobs/' + job.id}>Job {job.number}</a> : null}
          {inv.status === 'open' ? <button className="btn" onClick={() => setEditing(true)}>Edit lines</button> : null}
          <button className="btn" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="panel no-print">
        <KV k="Customer email" v={inv.billToEmail} />
        <KV k="Customer phone" v={inv.billToPhone} />
        <KV k="Invoice email" v={emailLabel(inv.invoiceEmail, inv.invoiceEmailedAt)} />
        {inv.status === 'paid' ? <KV k="Receipt email" v={emailLabel(inv.receiptEmail, inv.receiptEmailedAt)} /> : null}
        {inv.paidReference ? <KV k="Payment reference" v={inv.paidReference} mono /> : null}
        <ShareButtons inv={inv} />
      </div>
      <InvoiceDoc d={docFromInvoice(inv, company)} />
      {editing ? <EditLines inv={inv} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

export function SettingsPage() {
  const { company, emailReady, me, toast, reload } = useStore()
  const [c, setC] = useState<Company | null>(company)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (company && !c) setC(company) }, [company])
  if (!invoicesEnabled()) return <InvoicesPage />
  if (!c) return <div className="page"><div className="loading">Loading…</div></div>
  const owner = me?.role === 'owner'
  const set = (k: keyof Company) => (e: any) => setC({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <div className="page form-page">
      <div className="page-head"><h1>Invoice settings</h1></div>
      {!owner ? <p className="muted small">Only the owner can change these.</p> : null}
      <fieldset disabled={!owner}>
        <legend>Your business on every invoice</legend>
        <div className="grid">
          <Field label="Business name"><input id="co-name" value={c.name} onChange={set('name')} /></Field>
          <Field label="Phone"><input id="co-phone" value={c.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input id="co-email" type="email" value={c.email} onChange={set('email')} /></Field>
          <Field label="Website"><input id="co-web" value={c.website} onChange={set('website')} /></Field>
          <Field label="Address" wide><input id="co-addr" value={c.address} onChange={set('address')} /></Field>
          <Field label="How customers pay you" wide hint="Shown on unpaid invoices, for example your Zelle phone or email and that you accept cards by phone.">
            <textarea id="co-pay" rows={2} value={c.paymentInstructions} onChange={set('paymentInstructions')} />
          </Field>
          <Field label="Footer note" wide><input id="co-foot" value={c.footer} onChange={set('footer')} /></Field>
          <Field label="Sales tax (%)" hint="Added on top of the final amount. Leave 0 if your prices already include tax. Check with your accountant.">
            <input id="co-tax" type="number" step="0.001" min="0" className="mono" value={Math.round(c.taxRate * 100000) / 1000} onChange={(e) => setC({ ...c, taxRate: (Number(e.target.value) || 0) / 100 })} />
          </Field>
        </div>
      </fieldset>
      <fieldset disabled={!owner}>
        <legend>Automatic emails</legend>
        {emailReady ? (
          <label className="check"><input id="co-emailon" type="checkbox" checked={c.emailInvoices} onChange={set('emailInvoices')} /> Email customers their invoice when a job is completed, and a paid receipt when it's paid</label>
        ) : (
          <p className="small">Email isn't connected yet. Sending to customers needs a domain you own plus a free Resend account. Until then, use <strong>Text link</strong> or <strong>Copy link</strong> on each invoice.</p>
        )}
      </fieldset>
      {owner ? (
        <div className="form-foot">
          <button className="btn primary big" disabled={busy} onClick={async () => {
            setBusy(true)
            try { await saveCompany(c); toast('Settings saved'); await reload() } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
          }}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      ) : null}
    </div>
  )
}
