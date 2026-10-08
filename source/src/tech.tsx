import React, { useEffect, useState } from 'react'
import { useStore } from './store'
import { Empty, Field, Modal, PriorityBadge, StatusBadge } from './ui'
import { PartsBadge, PartsPanel } from './parts'
import {
  Job, acceptJob, fmtDateTime, fmtWhen, isToday, locallyAccepted, mapsHref, money, queueText, setStatus, telHref, titleCase, updateJob,
} from './model'

const isAccepted = (j: Job) => !!j.acceptedAt || locallyAccepted().includes(j.id) || ['on_the_way', 'arrived', 'completed'].includes(j.status)

export function TechHome({ openJob }: { openJob: (id: string) => void }) {
  const { jobs, userId, loading, me } = useStore()
  const [tab, setTab] = useState<'today' | 'upcoming' | 'done'>('today')
  const mine = jobs.filter((j) => j.techId === userId)
  const active = mine.find((j) => j.status === 'on_the_way' || j.status === 'arrived')
  const open = mine.filter((j) => ['new', 'scheduled', 'assigned'].includes(j.status))
  const today = open.filter((j) => j.asap || !j.scheduledAt || isToday(j.scheduledAt) || j.scheduledAt < new Date())
    .sort((a, b) => (a.priority === 'emergency' ? -1 : 0) - (b.priority === 'emergency' ? -1 : 0) || (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
  const upcoming = open.filter((j) => !today.includes(j)).sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
  const done = mine.filter((j) => j.status === 'completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)).slice(0, 40)
  const list = tab === 'today' ? today : tab === 'upcoming' ? upcoming : done

  return (
    <div className="tech">
      <div className="tech-hello">Hi {me?.name?.split(' ')[0] || 'there'}</div>
      {active ? (
        <button className="active-job" onClick={() => openJob(active.id)}>
          <span className="aj-label">Active job · {active.status === 'arrived' ? 'On site' : 'On the way'}</span>
          <span className="aj-name">{active.customerName}</span>
          <span className="aj-addr">{active.fullAddress}</span>
          <span className="aj-go">Open job ›</span>
        </button>
      ) : null}
      <div className="tabs">
        <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>Today <span className="mono">{today.length}</span></button>
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming <span className="mono">{upcoming.length}</span></button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Done</button>
      </div>
      {loading && !jobs.length ? <div className="loading">Loading…</div> : list.length === 0 ? (
        <Empty>{tab === 'today' ? 'No jobs waiting. New jobs show up here automatically.' : tab === 'upcoming' ? 'Nothing scheduled ahead.' : 'No completed jobs yet.'}</Empty>
      ) : (
        <div className="tech-list">
          {list.map((j) => (
            <button key={j.id} className={'tcard' + (j.priority === 'emergency' ? ' is-emergency' : '')} onClick={() => openJob(j.id)}>
              <span className="tc-top">
                <StatusBadge status={j.status} />
                <PriorityBadge p={j.priority} />
                {!isAccepted(j) && j.status !== 'completed' ? <span className="badge new-dot">Needs accept</span> : null}
                <PartsBadge jobId={j.id} />
              </span>
              <span className="tc-name">{j.customerName}</span>
              <span className="tc-line">{j.serviceType || titleCase(j.category)}</span>
              <span className="tc-line">{j.fullAddress}</span>
              <span className={'tc-when' + (j.asap ? ' asap' : '')}>{j.status === 'completed' ? `Completed · ${money(j.final)}` : fmtWhen(j)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TechJob({ id, back }: { id: string; back: () => void }) {
  const { jobs, userId, toast, reload } = useStore()
  const job = jobs.find((j) => j.id === id)
  const [busy, setBusy] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [, bump] = useState(0)
  useEffect(() => { window.scrollTo(0, 0) }, [id])
  if (!job) return <div className="tech"><button className="back" onClick={back}>‹ My jobs</button><Empty>This job is no longer assigned to you.</Empty></div>

  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try { await fn(); toast(msg); bump((x) => x + 1); await reload() } catch (e: any) { toast(e.message || String(e), 'err') } finally { setBusy(false) }
  }
  const accepted = isAccepted(job)
  const v = job.vehicle
  const vehicle = [v.year, v.make, v.model, v.color].filter(Boolean).join(' ')

  let action: React.ReactNode = null
  if (job.status === 'completed') action = <div className="done-box">Completed · Final {money(job.final)}</div>
  else if (job.status === 'cancelled') action = <div className="done-box muted">This job was cancelled.</div>
  else if (!accepted) action = <button className="bigbtn accept" disabled={busy} onClick={() => run(() => acceptJob(job, userId), 'Job accepted')}>ACCEPT JOB</button>
  else if (job.status === 'arrived') action = <button className="bigbtn complete" disabled={busy} onClick={() => setCompleting(true)}>COMPLETE JOB</button>
  else if (job.status === 'on_the_way') action = <button className="bigbtn arrived" disabled={busy} onClick={() => run(() => setStatus(job, 'arrived'), 'Marked arrived')}>ARRIVED</button>
  else action = (
    <button className="bigbtn otw" disabled={busy} onClick={() => run(async () => {
      await setStatus(job, 'on_the_way')
      await queueText(job, 'Your locksmith is on the way and should arrive shortly.', 'on_the_way')
    }, 'On your way')}>ON MY WAY</button>
  )

  return (
    <div className="tech">
      <button className="back" onClick={back}>‹ My jobs</button>
      <div className="tj-head">
        <div className="badges"><StatusBadge status={job.status} /><PriorityBadge p={job.priority} /><span className="mono muted">{job.number}</span></div>
        <h1>{job.customerName}</h1>
        <div className={'tj-when' + (job.asap ? ' asap' : '')}>{fmtWhen(job)}</div>
      </div>

      <div className="tj-actions">
        {job.phone ? <a className="tbtn" href={telHref(job.phone)}>Call<span className="mono">{job.phone}</span></a> : null}
        {job.fullAddress ? <a className="tbtn" href={mapsHref(job.fullAddress)} target="_blank" rel="noreferrer">Directions<span>{job.address || job.fullAddress}</span></a> : null}
      </div>

      <div className="tj-primary">{action}</div>

      <div className="tj-info">
        <div className="ti"><span className="k">Service</span><span>{[job.serviceType, titleCase(job.category)].filter(Boolean).join(' · ') || 'Not set'}</span></div>
        <div className="ti"><span className="k">Address</span><span>{job.fullAddress || 'Not set'}</span></div>
        {job.description ? <div className="ti"><span className="k">Description</span><span>{job.description}</span></div> : null}
        {vehicle || v.vin ? <div className="ti"><span className="k">Vehicle</span><span>{vehicle}{v.vin ? <><br /><span className="mono">VIN {v.vin}</span></> : null}</span></div> : null}
        {job.lockDetails ? <div className="ti"><span className="k">Lock / key</span><span>{job.lockDetails}</span></div> : null}
        {job.techNotes ? <div className="ti"><span className="k">Notes</span><span>{job.techNotes}</span></div> : null}
        <div className="ti"><span className="k">Estimate</span><span className="mono">{money(job.estimate)}</span></div>
        {job.completedAt ? <div className="ti"><span className="k">Completed</span><span>{fmtDateTime(job.completedAt)}</span></div> : null}
      </div>

      {accepted && job.status !== 'cancelled' ? (
        <div className="tj-parts">
          <span className="tj-sec">Parts</span>
          <PartsPanel job={job} mode="tech" />
        </div>
      ) : null}

      {completing ? <CompleteModal job={job} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); toast('Job completed. The office will handle payment.'); reload() }} /> : null}
    </div>
  )
}

function CompleteModal({ job, onClose, onDone }: { job: Job; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(job.final !== null ? String(job.final) : job.estimate !== null ? String(job.estimate) : '')
  const [notes, setNotes] = useState(job.techNotes)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Complete job" onClose={onClose}>
      <Field label="Final amount ($)">
        <input id="cm-amt" autoFocus type="number" inputMode="decimal" step="0.01" min="0" className="mono big-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {job.estimate !== null ? <p className="muted small">Estimate was {money(job.estimate)}</p> : null}
      <Field label="Technician notes">
        <textarea id="cm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Work done, parts used…" />
      </Field>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="bigbtn complete" disabled={busy || amount === ''} onClick={async () => {
        setBusy(true); setErr('')
        try {
          const final = Number(amount)
          await setStatus(job, 'completed', { final, tech_notes: notes.trim() || null })
          await queueText(job, `Your locksmith service has been completed. Your final balance is ${money(final)}. Our office will contact you shortly to process payment. Thank you.`, 'job_completed')
          onDone()
        } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
      }}>{busy ? 'Saving…' : `COMPLETE · ${money(Number(amount) || 0)}`}</button>
    </Modal>
  )
}
