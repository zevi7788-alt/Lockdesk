import { APP_NAME } from './brand'
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { Empty, Field, JobCard, KV, Modal, PayBadge, PriorityBadge, Section, StatusBadge, go } from './ui'
import {
  ACTIVE, Job, JobEvent, PAY_LABEL, PAY_METHODS, PayMethod, STATUSES, STATUS_LABEL,
  fmtDateTime, fmtTime, fmtWhen, isToday, loadEvents, loadNotifications, mapsHref, money, recordPayment,
  setPayStatus, setStatus, telHref, titleCase, todayISO, updateJob, saveCustomer, Status, Customer,
} from './model'
import { col, get, schema, scanSchema, SPEC } from './db'
import { PartsBadge, PartsPanel, PartsSetup } from './parts'
import { SetupScript } from './setup'
import { BackupPanel, BackupReminder, ProblemReport, BUILD } from './backup'
import { CustomerInvoices, JobInvoicePanel, invoicesEnabled } from './invoices'
import { partsEnabled, partsState, approvalEnabled } from './model'

const PRI_RANK: Record<string, number> = { emergency: 0, high: 1, normal: 2, low: 3 }
const byUrgency = (a: Job, b: Job) =>
  PRI_RANK[a.priority] - PRI_RANK[b.priority] || (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)

// ---------------- Dashboard ----------------

export function Dashboard() {
  const { jobs, loading, partsFor, me } = useStore()
  const open = jobs.filter((j) => ACTIVE.includes(j.status))
  const urgent = open.filter((j) => j.priority === 'emergency' || j.priority === 'high').sort(byUrgency)
  const unassigned = open.filter((j) => !j.techId && !urgent.includes(j)).sort(byUrgency)
  const inField = open.filter((j) => (j.status === 'on_the_way' || j.status === 'arrived') && !urgent.includes(j))
  const today = open
    .filter((j) => j.techId && !['on_the_way', 'arrived'].includes(j.status) && !urgent.includes(j) && (j.asap || (j.scheduledAt && isToday(j.scheduledAt))))
    .sort(byUrgency)
  const upcoming = open
    .filter((j) => j.techId && !['on_the_way', 'arrived'].includes(j.status) && !urgent.includes(j) && !j.asap && j.scheduledAt && !isToday(j.scheduledAt) && j.scheduledAt > new Date())
    .sort(byUrgency)
    .slice(0, 8)
  const unpaid = jobs.filter((j) => j.status === 'completed' && j.payStatus !== 'paid' && j.payStatus !== 'voided' && j.payStatus !== 'refunded')
  const waitingParts = jobs.filter((j) => j.status !== 'cancelled' && (partsState(partsFor(j.id)) === 'needed' || partsState(partsFor(j.id)) === 'ordered' || partsState(partsFor(j.id)) === 'received'))
  const doneToday = jobs.filter((j) => j.status === 'completed' && j.completedAt && isToday(j.completedAt))

  const stats = [
    { k: 'Open jobs', v: open.length, href: 'jobs' },
    { k: 'Unassigned', v: open.filter((j) => !j.techId).length, href: 'jobs/filter/unassigned', warn: true },
    { k: 'In the field', v: open.filter((j) => j.status === 'on_the_way' || j.status === 'arrived').length, href: 'jobs/filter/field' },
    { k: 'Unpaid', v: unpaid.length, href: 'jobs/filter/unpaid', warn: true },
    { k: 'Unpaid balance', v: money(unpaid.reduce((a, j) => a + (j.final || 0), 0)), href: 'jobs/filter/unpaid' },
    { k: 'Completed today', v: doneToday.length, href: 'jobs/filter/completed' },
  ]

  if (loading && !jobs.length) return <div className="page"><div className="loading">Loading jobs…</div></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h1>Dispatch</h1>
        </div>
        <a className="btn primary" href="#/new">+ New job</a>
      </div>
      <BackupReminder />
      {!approvalEnabled() && me?.role === 'owner' ? (
        <div className="panel warn-panel">
          <h3>Security update needed</h3>
          <SetupScript compact intro={<>Right now anyone who creates an account can see your jobs and customers. This one time update makes every new account wait for your approval.</>} />
        </div>
      ) : null}
      <div className="stats">
        {stats.map((s) => (
          <a key={s.k} href={'#/' + s.href} className={'stat' + (s.warn && s.v ? ' warn' : '')}>
            <span className="stat-v mono">{s.v}</span>
            <span className="stat-k">{s.k}</span>
          </a>
        ))}
      </div>
      <div className="board">
        <Section title="Emergency and high priority" count={urgent.length}>
          {urgent.length ? <div className="cards">{urgent.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>No urgent jobs right now.</Empty>}
        </Section>
        <Section title="Needs a technician" count={unassigned.length}>
          {unassigned.length ? <div className="cards">{unassigned.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>Every open job is assigned.</Empty>}
        </Section>
        <Section title="In the field" count={inField.length}>
          {inField.length ? <div className="cards">{inField.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>No technicians on the road.</Empty>}
        </Section>
        <Section title="Today" count={today.length}>
          {today.length ? <div className="cards">{today.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>Nothing else scheduled for today.</Empty>}
        </Section>
        <Section title="Completed, awaiting payment" count={unpaid.length}>
          {unpaid.length ? <div className="cards">{unpaid.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>All completed jobs are paid.</Empty>}
        </Section>
        {partsEnabled() ? (
          <Section title="Waiting on parts" count={waitingParts.length}>
            {waitingParts.length ? <div className="cards">{waitingParts.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Empty>No parts outstanding.</Empty>}
          </Section>
        ) : null}
        {upcoming.length ? (
          <Section title="Coming up" count={upcoming.length}>
            <div className="cards">{upcoming.map((j) => <JobCard key={j.id} job={j} />)}</div>
          </Section>
        ) : null}
      </div>
    </div>
  )
}

// ---------------- Jobs list ----------------

const FILTERS: { id: string; label: string; test: (j: Job) => boolean }[] = [
  { id: 'open', label: 'Open', test: (j) => ACTIVE.includes(j.status) },
  { id: 'unassigned', label: 'Unassigned', test: (j) => ACTIVE.includes(j.status) && !j.techId },
  { id: 'field', label: 'In the field', test: (j) => j.status === 'on_the_way' || j.status === 'arrived' },
  { id: 'unpaid', label: 'Unpaid', test: (j) => j.status === 'completed' && j.payStatus !== 'paid' && j.payStatus !== 'voided' && j.payStatus !== 'refunded' },
  { id: 'completed', label: 'Completed', test: (j) => j.status === 'completed' },
  { id: 'cancelled', label: 'Cancelled', test: (j) => j.status === 'cancelled' },
  { id: 'all', label: 'All', test: () => true },
]

export function JobsList({ filter }: { filter?: string }) {
  const { jobs, techName, partsFor } = useStore()
  const [q, setQ] = useState('')
  const filters = partsEnabled()
    ? [...FILTERS.slice(0, 4), { id: 'parts', label: 'Parts', test: (j: Job) => j.status !== 'cancelled' && ['needed', 'ordered', 'received'].includes(partsState(partsFor(j.id)) || '') }, ...FILTERS.slice(4)]
    : FILTERS
  const active = filters.find((f) => f.id === filter) || filters[0]
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const digits = needle.replace(/\D/g, '')
    return jobs
      .filter(active.test)
      .filter((j) => !needle || [j.customerName, j.fullAddress, j.number, j.serviceType, j.description].join(' ').toLowerCase().includes(needle) || (digits.length >= 3 && j.phone.replace(/\D/g, '').includes(digits)))
      .sort(active.id === 'open' ? byUrgency : (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  }, [jobs, q, active])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Jobs</h1>
        <a className="btn primary" href="#/new">+ New job</a>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Search name, phone, address, job #" value={q} onChange={(e) => setQ(e.target.value)} id="jobs-search" />
        <div className="chips">
          {filters.map((f) => (
            <a key={f.id} href={'#/jobs/filter/' + f.id} className={'chip' + (f.id === active.id ? ' on' : '')}>
              {f.label} <span className="mono">{jobs.filter(f.test).length}</span>
            </a>
          ))}
        </div>
      </div>
      {list.length === 0 ? <Empty>No jobs match.</Empty> : (
        <>
          <div className="table-wrap desktop-only">
            <table className="table">
              <thead><tr><th>Job</th><th>Status</th><th>Customer</th><th>Service</th><th>When</th><th>Technician</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.id} onClick={() => go('jobs/' + j.id)} className={j.priority === 'emergency' ? 'row-emergency' : ''}>
                    <td className="mono">{j.number}</td>
                    <td><div className="badges"><StatusBadge status={j.status} /><PriorityBadge p={j.priority} /><PayBadge job={j} /><PartsBadge jobId={j.id} /></div></td>
                    <td><strong>{j.customerName}</strong><div className="sub">{j.fullAddress}</div></td>
                    <td>{j.serviceType}<div className="sub">{titleCase(j.category)}</div></td>
                    <td className={j.asap ? 'asap' : ''}>{fmtWhen(j)}</td>
                    <td className={j.techId ? '' : 'muted'}>{techName(j.techId)}</td>
                    <td className="r mono">{j.final !== null ? money(j.final) : j.estimate !== null ? <span className="muted">est {money(j.estimate)}</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cards mobile-only">{list.map((j) => <JobCard key={j.id} job={j} />)}</div>
        </>
      )}
    </div>
  )
}

// ---------------- Job detail (office) ----------------

export function Timeline({ job, events }: { job: Job; events: JobEvent[] }) {
  const { profiles } = useStore()
  const who = (id: string) => profiles.find((p) => p.id === id)?.name
  const rows: { at: Date | null; text: string }[] = events.map((e) => {
    let text = e.message
    if (!text) {
      if (e.to) text = (e.from ? `${STATUS_LABEL[e.from] || e.from} → ` : '') + (STATUS_LABEL[e.to] || e.to)
      else text = titleCase((e.type || 'update').replace(/_/g, ' '))
    }
    const w = who(e.actor)
    return { at: e.at, text: text + (w ? ` · ${w}` : '') }
  })
  if (!rows.length && job.createdAt) rows.push({ at: job.createdAt, text: 'Job created' })
  return (
    <ol className="timeline">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="t mono">{r.at ? (isToday(r.at) ? fmtTime(r.at) : fmtDateTime(r.at)) : ''}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ol>
  )
}

export function JobDetail({ id }: { id: string }) {
  const { jobs, techs, techName, userId, toast, reload, payments } = useStore()
  const job = jobs.find((j) => j.id === id)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [payOpen, setPayOpen] = useState(false)
  const [finalOpen, setFinalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!job) return
    loadEvents(job.id).then(setEvents)
    loadNotifications(job.id).then(setNotes)
  }, [job?.id, job?.status, job?.payStatus, job?.techId])

  if (!job) return <div className="page"><Empty>Job not found. It may have been deleted, or it is still loading.</Empty></div>

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try { await fn(); toast(msg); await reload() } catch (e: any) { toast(e.message || String(e), 'err') } finally { setBusy(false) }
  }

  const assign = (techId: string) =>
    act(() => updateJob(job.id, {
      tech_id: techId || null,
      ...(['new', 'scheduled', 'assigned'].includes(job.status) ? { status: techId ? 'assigned' : job.asap || !job.scheduledAt ? 'new' : 'scheduled' } : {}),
    }), techId ? `Assigned to ${techName(techId)}` : 'Unassigned')

  const jobPays = payments.filter((p) => p.jobId === job.id)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs"><a href="#/jobs">Jobs</a> / <span className="mono">{job.number}</span></div>
          <h1>{job.customerName}</h1>
          <div className="badges"><StatusBadge status={job.status} /><PriorityBadge p={job.priority} /><PayBadge job={job} /><PartsBadge jobId={job.id} /></div>
        </div>
        <div className="head-actions">
          <a className="btn" href={'#/jobs/' + job.id + '/edit'}>Edit</a>
          {job.status === 'completed' && job.payStatus !== 'paid' ? <button className="btn primary" onClick={() => setPayOpen(true)}>Record payment</button> : null}
        </div>
      </div>

      <div className="detail">
        <div className="col">
          <div className="panel">
            <h3>Customer</h3>
            <KV k="Name" v={job.customerName} />
            <KV k="Phone" v={job.phone ? <a href={telHref(job.phone)} className="mono">{job.phone}</a> : ''} />
            <KV k="Email" v={job.email} />
            <KV k="Address" v={job.fullAddress ? <a href={mapsHref(job.fullAddress)} target="_blank" rel="noreferrer">{job.fullAddress}</a> : ''} />
            {job.customerId ? <a className="link small" href={'#/customers/' + job.customerId}>Customer history</a> : null}
          </div>
          <div className="panel">
            <h3>Service</h3>
            <KV k="Service" v={job.serviceType} />
            <KV k="Category" v={titleCase(job.category)} />
            <KV k="Priority" v={titleCase(job.priority)} />
            <KV k="When" v={<span className={job.asap ? 'asap' : ''}>{fmtWhen(job)}</span>} />
            <KV k="Description" v={job.description} />
            <KV k="Lock / key" v={job.lockDetails} />
            {job.category === 'automotive' ? (
              <KV k="Vehicle" v={[job.vehicle.year, job.vehicle.make, job.vehicle.model, job.vehicle.color].filter(Boolean).join(' ') + (job.vehicle.vin ? ` · VIN ${job.vehicle.vin}` : '')} />
            ) : null}
          </div>
          <div className="panel">
            <h3>Parts</h3>
            <PartsPanel job={job} mode="office" />
          </div>
          <div className="panel">
            <h3>Notes</h3>
            <KV k="Dispatcher" v={job.dispatcherNotes} />
            <KV k="Technician" v={job.techNotes} />
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <h3>Dispatch</h3>
            <Field label="Technician">
              <select id="jd-tech" value={job.techId || ''} disabled={busy} onChange={(e) => assign(e.target.value)}>
                <option value="">Unassigned</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select id="jd-status" value={job.status} disabled={busy} onChange={(e) => act(() => setStatus(job, e.target.value as Status), 'Status updated')}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>

          <div className="panel">
            <h3>Money</h3>
            <KV k="Estimate" v={money(job.estimate)} mono />
            <KV k="Final" v={<span>{money(job.final)} <button className="link small" onClick={() => setFinalOpen(true)}>change</button></span>} mono />
            <KV k="Payment" v={job.status === 'completed' || job.payStatus === 'paid' ? titleCase(job.payStatus) : 'Due after completion'} />
            <KV k="Method" v={PAY_LABEL[job.payMethod] || job.payMethod} />
            {jobPays.map((p) => (
              <div key={p.id} className="payrow">
                <span className="mono">{money(p.amount)}</span>
                <span>{PAY_LABEL[p.method] || p.method}</span>
                <span className="muted">{p.at ? fmtDateTime(p.at) : ''}{p.ref ? ` · ref ${p.ref}` : ''}</span>
              </div>
            ))}
            {job.status === 'completed' && job.payStatus !== 'paid' ? (
              <button className="btn primary full" onClick={() => setPayOpen(true)}>Record payment</button>
            ) : null}
            {job.payStatus === 'paid' && col('jobs', 'payment_status') ? (
              <button className="link small" disabled={busy} onClick={() => act(() => setPayStatus(job, 'unpaid'), 'Marked unpaid')}>Mark unpaid</button>
            ) : null}
          </div>

          {job.status === 'completed' || job.payStatus === 'paid' ? (
            <div className="panel">
              <h3>Invoice</h3>
              <JobInvoicePanel job={job} />
            </div>
          ) : null}

          <div className="panel">
            <h3>Customer texts</h3>
            <p className="note-pending">SMS provider not connected yet. Texts are recorded below as queued and are not delivered until Twilio (or another provider) is set up.</p>
            {notes.length ? notes.map((n, i) => (
              <div key={i} className="sms">
                <div className="sms-meta"><span className="badge st-new">{titleCase(String(get(n, 'notifications', 'status') || 'queued'))}</span> <span className="muted">{get(n, 'notifications', 'created_at') ? fmtDateTime(new Date(get(n, 'notifications', 'created_at'))) : ''}</span></div>
                <div>{String(get(n, 'notifications', 'body') || '')}</div>
              </div>
            )) : <p className="muted small">No texts recorded for this job.</p>}
          </div>

          <div className="panel">
            <h3>Timeline</h3>
            <Timeline job={job} events={events} />
          </div>
        </div>
      </div>

      {payOpen ? <PaymentModal job={job} onClose={() => setPayOpen(false)} onDone={async () => { setPayOpen(false); toast('Payment recorded'); await reload() }} userId={userId} /> : null}
      {finalOpen ? <FinalModal job={job} onClose={() => setFinalOpen(false)} /> : null}
    </div>
  )
}

function FinalModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const { toast, reload } = useStore()
  const [v, setV] = useState(job.final === null ? '' : String(job.final))
  const [err, setErr] = useState('')
  return (
    <Modal title="Final amount" onClose={onClose}>
      <Field label="Final amount ($)"><input id="fm-amt" autoFocus type="number" step="0.01" inputMode="decimal" className="mono big-input" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full" onClick={async () => {
        try { await updateJob(job.id, { final: v === '' ? null : Number(v) }); toast('Final amount saved'); await reload(); onClose() } catch (e: any) { setErr(e.message) }
      }}>Save</button>
    </Modal>
  )
}

function PaymentModal({ job, onClose, onDone, userId }: { job: Job; onClose: () => void; onDone: () => void; userId: string }) {
  const [amount, setAmount] = useState(job.final !== null ? String(job.final) : job.estimate !== null ? String(job.estimate) : '')
  const [method, setMethod] = useState<PayMethod>('credit_card')
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`Record payment · ${job.number}`} onClose={onClose}>
      <p className="muted small">Take the card in your processor or terminal first, then record it here. {APP_NAME} never stores card numbers.</p>
      <Field label="Amount ($)"><input id="pm-amt" type="number" step="0.01" inputMode="decimal" className="mono big-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <div className="field">
        <span className="flabel">Method</span>
        <div className="seg wrap">
          {PAY_METHODS.map((m) => <button type="button" key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{PAY_LABEL[m]}</button>)}
        </div>
      </div>
      <Field label={method === 'credit_card' ? 'Processor reference (Square / Stripe transaction ID)' : method === 'check' ? 'Check number' : 'Reference'}>
        <input id="pm-ref" className="mono" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label="Notes"><input id="pm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full big" disabled={busy || !amount} onClick={async () => {
        setBusy(true); setErr('')
        try { await recordPayment(job, userId, { amount: Number(amount), method, ref, notes }); onDone() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
      }}>{busy ? 'Saving…' : `Mark paid · ${money(Number(amount) || 0)}`}</button>
    </Modal>
  )
}

// ---------------- Customers ----------------

export function Customers() {
  const { customers, jobs } = useStore()
  const [q, setQ] = useState('')
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    jobs.forEach((j) => j.customerId && m.set(j.customerId, (m.get(j.customerId) || 0) + 1))
    return m
  }, [jobs])
  const list = customers.filter((c) => {
    const n = q.trim().toLowerCase()
    if (!n) return true
    const digits = n.replace(/\D/g, '')
    return [c.name, c.address, c.city, c.email].join(' ').toLowerCase().includes(n) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
  })
  return (
    <div className="page">
      <div className="page-head"><h1>Customers</h1><span className="muted">{customers.length} total</span></div>
      <div className="toolbar"><input id="cust-search" className="search" placeholder="Search name, phone, or address" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length === 0 ? <Empty>{customers.length ? 'No customers match.' : 'Customers are added automatically when you create a job.'}</Empty> : (
        <div className="list">
          {list.slice(0, 300).map((c) => (
            <a key={c.id} className="list-row" href={'#/customers/' + c.id}>
              <div><strong>{c.name}</strong><div className="sub">{[c.address, c.city].filter(Boolean).join(', ')}</div></div>
              <div className="r"><span className="mono">{c.phone}</span><div className="sub">{counts.get(c.id) || 0} jobs</div></div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function CustomerDetail({ id }: { id: string }) {
  const { customers, jobs, toast, reload } = useStore()
  const c = customers.find((x) => x.id === id)
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState<Customer | null>(null)
  if (!c) return <div className="page"><Empty>Customer not found.</Empty></div>
  const history = jobs.filter((j) => j.customerId === c.id).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  const spent = history.filter((j) => j.payStatus === 'paid').reduce((a, j) => a + (j.final || 0), 0)
  const f = form || c
  const set = (k: keyof Customer) => (e: any) => setForm({ ...f, [k]: e.target.value })
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="crumbs"><a href="#/customers">Customers</a></div><h1>{c.name}</h1></div>
        <div className="head-actions">
          <button className="btn" onClick={() => { setEdit(!edit); setForm(null) }}>{edit ? 'Cancel' : 'Edit'}</button>
          <button className="btn primary" onClick={() => {
            sessionStorage.setItem('lockdesk.prefill', c.id); go('new')
          }}>+ New job</button>
        </div>
      </div>
      <div className="detail">
        <div className="col">
          <div className="panel">
            <h3>Contact</h3>
            {edit ? (
              <div className="grid">
                <Field label="Name"><input id="cd-name" value={f.name} onChange={set('name')} /></Field>
                <Field label="Phone"><input id="cd-phone" value={f.phone} onChange={set('phone')} /></Field>
                <Field label="Email"><input id="cd-email" value={f.email} onChange={set('email')} /></Field>
                <Field label="Address"><input id="cd-addr" value={f.address} onChange={set('address')} /></Field>
                <Field label="City"><input id="cd-city" value={f.city} onChange={set('city')} /></Field>
                <Field label="State"><input id="cd-state" value={f.state} onChange={set('state')} /></Field>
                <Field label="ZIP"><input id="cd-zip" value={f.zip} onChange={set('zip')} /></Field>
                <Field label="Notes" wide><textarea id="cd-notes" rows={3} value={f.notes} onChange={set('notes')} /></Field>
                <button className="btn primary wide" onClick={async () => {
                  try { await saveCustomer(c, f); toast('Customer saved'); setEdit(false); setForm(null); await reload() } catch (e: any) { toast(e.message, 'err') }
                }}>Save customer</button>
              </div>
            ) : (
              <>
                <KV k="Phone" v={c.phone ? <a className="mono" href={telHref(c.phone)}>{c.phone}</a> : ''} />
                <KV k="Email" v={c.email} />
                <KV k="Address" v={[c.address, c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')} />
                <KV k="Notes" v={c.notes} />
              </>
            )}
          </div>
        </div>
        <div className="col">
          <div className="panel">
            <h3>Job history</h3>
            <KV k="Jobs" v={history.length} mono />
            <KV k="Paid total" v={money(spent)} mono />
            <div className="list compact">
              {history.map((j) => (
                <a key={j.id} className="list-row" href={'#/jobs/' + j.id}>
                  <div><span className="mono">{j.number}</span> {j.serviceType}<div className="sub">{j.createdAt ? fmtDateTime(j.createdAt) : ''}</div></div>
                  <div className="r"><StatusBadge status={j.status} /><div className="sub mono">{j.final !== null ? money(j.final) : ''}</div></div>
                </a>
              ))}
            </div>
          </div>
          <CustomerInvoices customerId={c.id} />
        </div>
      </div>
    </div>
  )
}

// ---------------- Calendar ----------------

export function Calendar() {
  const { jobs, techName } = useStore()
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [day, setDay] = useState(todayISO())
  const byDay = useMemo(() => {
    const m = new Map<string, Job[]>()
    jobs.filter((j) => j.status !== 'cancelled').forEach((j) => {
      const dt = j.scheduledAt || (j.asap ? j.createdAt : null)
      if (!dt) return
      const k = todayISO(dt)
      m.set(k, [...(m.get(k) || []), j])
    })
    m.forEach((l) => l.sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)))
    return m
  }, [jobs])
  const start = new Date(cursor); start.setDate(1 - start.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  const month = cursor.getMonth()
  const dayJobs = byDay.get(day) || []
  const shift = (n: number) => { const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d) }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <strong className="month">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
          <button className="btn ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
          <button className="btn" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); setDay(todayISO()) }}>Today</button>
        </div>
      </div>
      <div className="cal-wrap">
        <div className="cal">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="cal-h">{d}</div>)}
          {cells.map((d) => {
            const k = todayISO(d)
            const l = byDay.get(k) || []
            return (
              <button key={k} className={'cal-c' + (d.getMonth() !== month ? ' out' : '') + (k === todayISO() ? ' today' : '') + (k === day ? ' sel' : '')} onClick={() => setDay(k)}>
                <span className="cal-d">{d.getDate()}</span>
                {l.length ? <span className="cal-n">{l.length} job{l.length > 1 ? 's' : ''}</span> : null}
                {l.some((j) => j.priority === 'emergency') ? <span className="cal-dot" /> : null}
              </button>
            )
          })}
        </div>
        <div className="agenda">
          <h3>{new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {dayJobs.length ? dayJobs.map((j) => (
            <a key={j.id} className="ag-row" href={'#/jobs/' + j.id}>
              <span className={'mono ag-t' + (j.asap ? ' asap' : '')}>{j.asap ? 'ASAP' : j.scheduledAt ? fmtTime(j.scheduledAt) : ''}</span>
              <span className="ag-b"><strong>{j.customerName}</strong> · {j.serviceType}<span className="sub">{techName(j.techId)} · {j.fullAddress}</span></span>
              <StatusBadge status={j.status} />
            </a>
          )) : <Empty>No jobs on this day.</Empty>}
          <a className="btn full" href="#/new">+ New job</a>
        </div>
      </div>
    </div>
  )
}

// ---------------- Reports ----------------

export function Reports() {
  const { jobs, techName, profiles } = useStore()
  const [range, setRange] = useState('month')
  const now = new Date()
  const from = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    if (range === 'today') return d
    if (range === 'week') { d.setDate(d.getDate() - d.getDay()); return d }
    if (range === 'month') { d.setDate(1); return d }
    if (range === 'year') { d.setMonth(0, 1); return d }
    return new Date(0)
  }, [range])
  const inRange = jobs.filter((j) => { const t = j.completedAt || j.scheduledAt || j.createdAt; return t && t >= from && t <= new Date(now.getTime() + 864e5 * 400) })
  const completed = inRange.filter((j) => j.status === 'completed')
  const paid = completed.filter((j) => j.payStatus === 'paid')
  const unpaid = completed.filter((j) => j.payStatus !== 'paid' && j.payStatus !== 'voided' && j.payStatus !== 'refunded')
  const revenue = paid.reduce((a, j) => a + (j.final || 0), 0)
  const billed = completed.reduce((a, j) => a + (j.final || 0), 0)
  const avg = completed.length ? billed / completed.length : 0
  const cancelled = inRange.filter((j) => j.status === 'cancelled').length

  const group = (key: (j: Job) => string, list: Job[]) => {
    const m = new Map<string, { n: number; amt: number }>()
    list.forEach((j) => { const k = key(j) || 'Not set'; const e = m.get(k) || { n: 0, amt: 0 }; e.n++; e.amt += j.final || 0; m.set(k, e) })
    return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt || b[1].n - a[1].n)
  }
  const byTech = group((j) => techName(j.techId), completed)
  const byService = group((j) => j.serviceType, completed)
  const byMethod = group((j) => PAY_LABEL[j.payMethod] || j.payMethod, paid)
  const byCreator = col('jobs', 'created_by') ? group((j) => profiles.find((p) => p.id === String(get(j.raw, 'jobs', 'created_by')))?.name || 'Unknown', inRange) : []

  const Bars = ({ rows, money: isMoney = true }: { rows: [string, { n: number; amt: number }][]; money?: boolean }) => {
    const max = Math.max(1, ...rows.map(([, v]) => (isMoney ? v.amt : v.n)))
    return rows.length ? (
      <div className="bars">
        {rows.map(([k, v]) => (
          <div key={k} className="bar-row">
            <span className="bar-k">{k}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${((isMoney ? v.amt : v.n) / max) * 100}%` }} /></span>
            <span className="bar-v mono">{isMoney ? money(v.amt) : v.n}<span className="muted"> · {v.n} job{v.n === 1 ? '' : 's'}</span></span>
          </div>
        ))}
      </div>
    ) : <Empty>No data in this range.</Empty>
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="seg">
          {[['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']].map(([k, l]) => (
            <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><span className="stat-v mono">{money(revenue)}</span><span className="stat-k">Collected</span></div>
        <div className="stat"><span className="stat-v mono">{completed.length}</span><span className="stat-k">Completed jobs</span></div>
        <div className="stat"><span className="stat-v mono">{money(avg)}</span><span className="stat-k">Average job</span></div>
        <div className={'stat' + (unpaid.length ? ' warn' : '')}><span className="stat-v mono">{unpaid.length}</span><span className="stat-k">Unpaid · {money(unpaid.reduce((a, j) => a + (j.final || 0), 0))}</span></div>
        <div className="stat"><span className="stat-v mono">{cancelled}</span><span className="stat-k">Cancelled</span></div>
        <div className="stat"><span className="stat-v mono">{inRange.length}</span><span className="stat-k">All jobs</span></div>
      </div>
      <div className="report-grid">
        <div className="panel"><h3>Revenue by technician</h3><Bars rows={byTech} /></div>
        <div className="panel"><h3>Revenue by service</h3><Bars rows={byService} /></div>
        <div className="panel"><h3>Payment methods</h3><Bars rows={byMethod} /></div>
        {byCreator.length ? <div className="panel"><h3>Jobs by dispatcher</h3><Bars rows={byCreator} money={false} /></div> : null}
      </div>
    </div>
  )
}

// ---------------- System check ----------------

export function SystemCheck() {
  const { reload, live, error, me } = useStore()
  const [, force] = useState(0)
  const [busy, setBusy] = useState(false)
  return (
    <div className="page">
      <div className="page-head">
        <h1>System check</h1>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await scanSchema(true); await reload(); force((x) => x + 1) } finally { setBusy(false) } }}>{busy ? 'Scanning…' : 'Rescan database'}</button>
      </div>
      <div className="report-grid">
        {me?.role === 'owner' ? <BackupPanel /> : null}
        <ProblemReport />
      </div>
      <div className="panel">
        <KV k="App version" v={BUILD} mono />
        <KV k="Realtime" v={live ? 'Connected' : 'Not connected (refreshing every 60 seconds)'} />
        <KV k="Last scan" v={schema.scannedAt ? new Date(schema.scannedAt).toLocaleString() : ''} />
        <KV k="Account approval" v={approvalEnabled() ? 'On. Every new account needs owner approval.' : 'Off. Run the update below.'} />
        <KV k="Parts ordering" v={partsEnabled() ? 'On' : 'Off. Run the update below.'} />
        <KV k="Invoices" v={invoicesEnabled() ? 'On' : 'Off. Run the update below.'} />
        <KV k="SMS" v="Not connected. Texts are queued only." />
        <KV k="Card processing" v="Not connected. Payments are recorded manually." />
        {error ? <div className="alert err">{error}</div> : null}
      </div>
      {!partsEnabled() || !approvalEnabled() || !invoicesEnabled() ? <div className="panel warn-panel"><h3>Database update</h3><SetupScript intro="Turns on owner approval for every account, owner managed password resets, parts ordering, and automatic invoices. It only adds to your database and is safe to run more than once." /></div> : null}
      <p className="muted small">{APP_NAME} detects your database columns automatically. If something looks wrong, screenshot this page and send it over.</p>
      <div className="report-grid">
        {Object.keys(SPEC).map((t) => (
          <div className="panel" key={t}>
            <h3>{t} {schema.tables[t] === false ? <span className="badge pr-emergency">missing</span> : schema.tables[t] ? <span className="badge st-completed">ok</span> : <span className="badge">no access</span>}</h3>
            <div className="mapping">
              {Object.entries(schema.cols[t] || {}).map(([f, c]) => (
                <div key={f} className={c ? '' : 'muted'}><span>{f}</span><span className="mono">{c || 'not found'}</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
