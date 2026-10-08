import React, { useState } from 'react'
import { useStore } from './store'
import { Field, Modal } from './ui'
import { Job, Part, PART_LABEL, addPart, deletePart, money, partsEnabled, partsState, updatePart } from './model'
import { PARTS_SQL } from './partsSql'

export function PartsBadge({ jobId }: { jobId: string }) {
  const { partsFor } = useStore()
  const st = partsState(partsFor(jobId))
  if (!st || st === 'installed') return null
  const label = st === 'needed' ? 'Part needed' : st === 'ordered' ? 'Part ordered' : 'Part in'
  return <span className={'badge part-' + st}>{label}</span>
}

export function PartsSetup({ compact }: { compact?: boolean }) {
  const [shown, setShown] = useState(!compact)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(PARTS_SQL); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {
      const el = document.getElementById('parts-sql') as HTMLTextAreaElement | null
      el?.select()
    }
  }
  return (
    <div className="setup">
      <p className="small">Parts ordering needs a one time database update. It adds a parts table and does not change anything you already have.</p>
      {shown ? (
        <>
          <ol className="small steps">
            <li>Tap <strong>Copy setup script</strong>.</li>
            <li>In Supabase, open <strong>SQL Editor</strong>, paste it, and tap <strong>Run</strong>.</li>
            <li>Come back here and open <strong>System check</strong>, then <strong>Rescan database</strong>.</li>
          </ol>
          <button className="btn primary full" onClick={copy}>{copied ? 'Copied' : 'Copy setup script'}</button>
          <textarea id="parts-sql" className="mono sql" readOnly rows={6} value={PARTS_SQL} onFocus={(e) => e.target.select()} />
        </>
      ) : <button className="btn full" onClick={() => setShown(true)}>Set up parts ordering</button>}
    </div>
  )
}

function PartForm({ office, onSave, onClose }: { office: boolean; onSave: (p: any) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [pn, setPn] = useState('')
  const [supplier, setSupplier] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={office ? 'Add part' : 'Request a part'} onClose={onClose}>
      <Field label="Part *"><input id="pf-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Schlage B60 deadbolt, satin nickel" /></Field>
      <div className="grid">
        <Field label="Quantity"><input id="pf-qty" type="number" inputMode="numeric" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Part / key number"><input id="pf-pn" className="mono" value={pn} onChange={(e) => setPn(e.target.value)} /></Field>
        {office ? (
          <>
            <Field label="Supplier"><input id="pf-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="IDN, Clark, Amazon…" /></Field>
            <Field label="Cost ($)"><input id="pf-cost" type="number" inputMode="decimal" step="0.01" className="mono" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          </>
        ) : null}
      </div>
      <Field label="Notes"><textarea id="pf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={office ? '' : 'Finish, handing, door thickness, vehicle details…'} /></Field>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full big" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true); setErr('')
        try {
          await onSave({ name, quantity: Number(qty) || 1, partNumber: pn, notes, ...(office ? { supplier, cost: cost === '' ? null : Number(cost) } : {}) })
          onClose()
        } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
      }}>{busy ? 'Saving…' : office ? 'Add part' : 'Send request to office'}</button>
    </Modal>
  )
}

function OrderForm({ part, onClose }: { part: Part; onClose: () => void }) {
  const { toast, reload } = useStore()
  const [supplier, setSupplier] = useState(part.supplier)
  const [cost, setCost] = useState(part.cost === null ? '' : String(part.cost))
  const [eta, setEta] = useState(part.expectedOn)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')
  return (
    <Modal title={`Order · ${part.name}`} onClose={onClose}>
      <div className="grid">
        <Field label="Supplier"><input id="of-sup" autoFocus value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Cost ($)"><input id="of-cost" type="number" inputMode="decimal" step="0.01" className="mono" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Expected"><input id="of-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
        <Field label="Order number"><input id="of-ref" className="mono" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full big" onClick={async () => {
        try {
          const notes = ref.trim() ? [part.notes, `Order #${ref.trim()}`].filter(Boolean).join('\n') : part.notes || null
          await updatePart(part.id, { status: 'ordered', supplier: supplier.trim() || null, cost: cost === '' ? null : Number(cost), expected_on: eta || null, ordered_at: new Date().toISOString(), notes })
          toast('Part marked ordered'); await reload(); onClose()
        } catch (e: any) { setErr(e.message) }
      }}>Mark ordered</button>
    </Modal>
  )
}

export function PartsPanel({ job, mode }: { job: Job; mode: 'office' | 'tech' }) {
  const { partsFor, toast, reload } = useStore()
  const [adding, setAdding] = useState(false)
  const [ordering, setOrdering] = useState<Part | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const office = mode === 'office'

  if (!partsEnabled()) {
    return office ? <PartsSetup compact /> : <p className="muted small">Parts requests are not set up yet. Ask the office.</p>
  }

  const parts = partsFor(job.id)
  const act = async (fn: () => Promise<any>, msg: string) => {
    try { await fn(); toast(msg); await reload() } catch (e: any) { toast(e.message, 'err') }
  }
  const total = parts.filter((p) => p.status !== 'cancelled' && p.cost !== null).reduce((a, p) => a + (p.cost || 0) * p.quantity, 0)

  return (
    <div className="parts">
      {parts.length === 0 ? <p className="muted small">{office ? 'No parts on this job.' : 'No parts requested.'}</p> : (
        <div className="part-list">
          {parts.map((p) => (
            <div key={p.id} className={'part' + (p.status === 'cancelled' ? ' cancelled' : '')}>
              <div className="part-main">
                <div className="part-name"><strong>{p.name}</strong>{p.quantity > 1 ? <span className="mono"> × {p.quantity}</span> : null}</div>
                <div className="sub">
                  {[p.partNumber && `#${p.partNumber}`, p.supplier, p.cost !== null && office ? money(p.cost) : '', p.status === 'ordered' && p.expectedOn ? `expected ${new Date(p.expectedOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '']
                    .filter(Boolean).join(' · ')}
                </div>
                {p.notes ? <div className="sub pre">{p.notes}</div> : null}
              </div>
              <div className="part-side">
                <span className={'badge part-' + p.status}>{PART_LABEL[p.status]}</span>
                <div className="part-actions">
                  {office && p.status === 'needed' ? <button className="btn sm primary" onClick={() => setOrdering(p)}>Order</button> : null}
                  {office && p.status === 'ordered' ? <button className="btn sm primary" onClick={() => act(() => updatePart(p.id, { status: 'received', received_at: new Date().toISOString() }), 'Part received')}>Received</button> : null}
                  {p.status === 'received' ? <button className="btn sm primary" onClick={() => act(() => updatePart(p.id, { status: 'installed' }), 'Part installed')}>Installed</button> : null}
                  {office && p.status !== 'cancelled' && p.status !== 'installed' ? (
                    confirmDel === p.id ? (
                      <>
                        <button className="btn sm" onClick={() => { setConfirmDel(null); act(() => updatePart(p.id, { status: 'cancelled' }), 'Part cancelled') }}>Yes, cancel</button>
                        <button className="btn sm ghost" onClick={() => setConfirmDel(null)}>Keep</button>
                      </>
                    ) : <button className="btn sm ghost" onClick={() => setConfirmDel(p.id)}>Cancel</button>
                  ) : null}
                  {office && p.status === 'cancelled' ? <button className="btn sm ghost" onClick={() => act(() => deletePart(p.id), 'Part removed')}>Remove</button> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {office && total > 0 ? <div className="part-total"><span className="muted">Parts cost</span><span className="mono">{money(total)}</span></div> : null}
      {job.status !== 'cancelled' ? (
        <button className={'btn full' + (office ? '' : ' big')} onClick={() => setAdding(true)}>{office ? '+ Add part' : '+ Request a part'}</button>
      ) : null}
      {adding ? <PartForm office={office} onClose={() => setAdding(false)} onSave={async (p) => { await addPart(job.id, p); toast(office ? 'Part added' : 'Part requested. The office will order it.'); await reload() }} /> : null}
      {ordering ? <OrderForm part={ordering} onClose={() => setOrdering(null)} /> : null}
    </div>
  )
}
