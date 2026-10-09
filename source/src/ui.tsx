import { APP_NAME, APP_TAGLINE } from './brand'
import React, { useEffect, useState } from 'react'
import { Job, STATUS_LABEL, fmtWhen, money, titleCase } from './model'
import { useStore } from './store'
import { PartsBadge } from './parts'

// Tiny hash router: #/jobs/123 -> ['jobs','123']
export function useRoute(): string[] {
  const [h, setH] = useState(location.hash)
  useEffect(() => {
    const f = () => { setH(location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return h.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}
export const go = (path: string) => { location.hash = '#/' + path }

export function StatusBadge({ status }: { status: string }) {
  return <span className={'badge st-' + status}>{STATUS_LABEL[status] || status}</span>
}
export function PriorityBadge({ p }: { p: string }) {
  if (p === 'normal' || !p) return null
  return <span className={'badge pr-' + p}>{p === 'emergency' ? 'Emergency' : titleCase(p)}</span>
}
export function PayBadge({ job }: { job: Job }) {
  if (job.status !== 'completed') return null
  const s = job.payStatus
  return <span className={'badge pay-' + s}>{s === 'paid' ? 'Paid' : titleCase(s)}</span>
}

export function JobCard({ job, showTech = true }: { job: Job; showTech?: boolean }) {
  const { techName } = useStore()
  return (
    <a className={'jobcard' + (job.priority === 'emergency' ? ' is-emergency' : '')} href={'#/jobs/' + job.id}>
      <div className="jc-top">
        <StatusBadge status={job.status} />
        <PriorityBadge p={job.priority} />
        <PayBadge job={job} />
        <PartsBadge jobId={job.id} />
        <span className="jc-num mono">{job.number}</span>
      </div>
      <div className="jc-name">{job.customerName}</div>
      <div className="jc-line">{job.fullAddress || 'No address'}</div>
      <div className="jc-line">{[job.serviceType, titleCase(job.category)].filter(Boolean).join(' · ') || 'Service not set'}</div>
      <div className="jc-foot">
        <span className={job.asap ? 'asap' : ''}>{fmtWhen(job)}</span>
        {job.status === 'completed' ? (
          <span className="mono">Final {money(job.final)}</span>
        ) : showTech ? (
          <span className={job.techId ? '' : 'muted'}>{techName(job.techId)}</span>
        ) : null}
      </div>
    </a>
  )
}

export function Field({ label, children, wide, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={'field' + (wide ? ' wide' : '')}>
      <span className="flabel">{label}</span>
      {children}
      {hint ? <span className="fhint">{hint}</span> : null}
    </label>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}{count !== undefined ? <span className="count">{count}</span> : null}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={'v' + (mono ? ' mono' : '')}>{v === '' || v === null || v === undefined ? <span className="muted">None</span> : v}</span>
    </div>
  )
}


export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      <rect x="4.5" y="10" width="15" height="11.5" rx="1.6" fill="currentColor" />
      <circle cx="12" cy="14.6" r="1.55" fill="var(--mark-cut, #fff)" />
      <rect x="11.3" y="15.2" width="1.4" height="3.3" rx=".5" fill="var(--mark-cut, #fff)" />
    </svg>
  )
}

export function Brand({ big, mark, tagline = true }: { big?: boolean; mark?: React.ReactNode; tagline?: boolean }) {
  return (
    <div className={'brand' + (big ? ' big' : '')}>
      <span className="brand-mark">{mark ?? <Mark />}</span>
      <span className="brand-text">
        <span className="brand-name">{APP_NAME}</span>
        {tagline ? <span className="brand-tag">{APP_TAGLINE}</span> : null}
      </span>
    </div>
  )
}
