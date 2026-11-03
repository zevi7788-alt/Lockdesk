import React, { useMemo, useState } from 'react'
import { useStore } from './store'
import { Field, go } from './ui'
import { CATEGORIES, Job, JobForm, PRIORITIES, SERVICE_TYPES, emptyJobForm, jobToForm, saveJob, titleCase, Customer, fmtSpan } from './model'
import { has, col } from './db'

// Common arrival windows (start, end)
const WINDOWS: [string, string][] = [['08:00', '10:00'], ['10:00', '12:00'], ['12:00', '14:00'], ['14:00', '16:00'], ['16:00', '18:00'], ['18:00', '20:00']]

export function JobFormPage({ existing, prefill }: { existing?: Job; prefill?: Customer }) {
  const { userId, techs, customers, toast, reload } = useStore()
  const [f, setF] = useState<JobForm>(() => {
    if (existing) return jobToForm(existing)
    const f = emptyJobForm()
    if (prefill) Object.assign(f, { customerId: prefill.id, name: prefill.name, phone: prefill.phone, email: prefill.email, address: prefill.address, city: prefill.city, state: prefill.state || f.state, zip: prefill.zip })
    return f
  })
  const windows = has('jobs', 'scheduled_end')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [showMatches, setShowMatches] = useState(true)
  const set = (k: keyof JobForm) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  // Match existing customers by phone digits or name as the dispatcher types
  const matches = useMemo(() => {
    if (f.customerId || existing) return []
    const digits = f.phone.replace(/\D/g, '')
    const nm = f.name.trim().toLowerCase()
    if (digits.length < 3 && nm.length < 2) return []
    return customers
      .filter((c) => (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)) || (nm.length >= 2 && c.name.toLowerCase().includes(nm)))
      .slice(0, 5)
  }, [f.phone, f.name, f.customerId, customers, existing])

  const pick = (c: Customer) => {
    setF({ ...f, customerId: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, city: c.city, state: c.state || f.state, zip: c.zip })
    setShowMatches(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setSaving(true)
    try {
      const id = await saveJob(f, userId, existing)
      toast(existing ? 'Job updated' : 'Job created')
      await reload()
      go('jobs/' + id)
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const auto = f.category === 'automotive'
  const hasVehicle = has('jobs', 'v_make') || has('jobs', 'v_model')

  return (
    <form className="page form-page" onSubmit={submit}>
      <div className="page-head">
        <h1>{existing ? `Edit ${existing.number}` : 'New job'}</h1>
        <div className="head-actions">
          <button type="button" className="btn ghost" onClick={() => history.back()}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Create job'}</button>
        </div>
      </div>
      {err ? <div className="alert err">{err}</div> : null}

      <fieldset>
        <legend>Customer</legend>
        <div className="grid">
          <Field label="Phone *">
            <input id="jf-phone" type="tel" inputMode="tel" autoFocus={!existing} value={f.phone} onChange={(e) => { setShowMatches(true); set('phone')(e) }} placeholder="845 555 1234" />
          </Field>
          <Field label="Name *">
            <input id="jf-name" value={f.name} onChange={(e) => { setShowMatches(true); set('name')(e) }} placeholder="John Smith" />
          </Field>
          {showMatches && matches.length > 0 ? (
            <div className="matches wide">
              <span className="flabel">Existing customer?</span>
              {matches.map((c) => (
                <button type="button" key={c.id} className="match" onClick={() => pick(c)}>
                  <strong>{c.name}</strong> <span className="mono">{c.phone}</span> <span className="muted">{c.address}</span>
                </button>
              ))}
            </div>
          ) : null}
          {f.customerId && !existing ? (
            <div className="wide picked">
              Linked to existing customer.{' '}
              <button type="button" className="link" onClick={() => setF({ ...f, customerId: null })}>Unlink</button>
            </div>
          ) : null}
          <Field label="Email"><input id="jf-email" type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Service</legend>
        <div className="seg" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={f.category === c ? 'on' : ''} onClick={() => setF({ ...f, category: c })}>{titleCase(c)}</button>
          ))}
        </div>
        <div className="grid">
          <Field label="Service type">
            <input id="jf-service" list="service-types" value={f.serviceType} onChange={set('serviceType')} placeholder="Lockout, Rekey, Car key…" />
            <datalist id="service-types">{SERVICE_TYPES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Priority">
            <div className="seg small">
              {PRIORITIES.map((p) => (
                <button type="button" key={p} className={(f.priority === p ? 'on ' : '') + 'p-' + p}
                  onClick={() => setF({ ...f, priority: p, asap: p === 'emergency' ? true : f.asap })}>{titleCase(p)}</button>
              ))}
            </div>
          </Field>
          <Field label="What does the customer need?" wide>
            <textarea id="jf-desc" rows={3} value={f.description} onChange={set('description')} placeholder="Locked out of front door. Kwikset deadbolt." />
          </Field>
        </div>
      </fieldset>

      {auto && hasVehicle ? (
        <fieldset>
          <legend>Vehicle</legend>
          <div className="grid four">
            <Field label="Year"><input id="jf-year" inputMode="numeric" value={f.year} onChange={set('year')} /></Field>
            <Field label="Make"><input id="jf-make" value={f.make} onChange={set('make')} /></Field>
            <Field label="Model"><input id="jf-model" value={f.model} onChange={set('model')} /></Field>
            <Field label="Color"><input id="jf-color" value={f.color} onChange={set('color')} /></Field>
            <Field label={col('jobs', 'v_vin') === 'vehicle_plate' ? 'License plate' : 'VIN'} wide><input id="jf-vin" className="mono" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value.toUpperCase() })} /></Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Location</legend>
        <div className="grid four">
          <Field label="Address" wide><input id="jf-addr" value={f.address} onChange={set('address')} placeholder="123 Main Street" /></Field>
          <Field label="City"><input id="jf-city" value={f.city} onChange={set('city')} /></Field>
          <Field label="State"><input id="jf-state" value={f.state} onChange={set('state')} maxLength={2} /></Field>
          <Field label="ZIP"><input id="jf-zip" inputMode="numeric" value={f.zip} onChange={set('zip')} /></Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Schedule and assignment</legend>
        <div className="grid four">
          <div className="field">
            <span className="flabel">When</span>
            <button type="button" className={'asap-toggle' + (f.asap ? ' on' : '')} onClick={() => setF({ ...f, asap: !f.asap })}>
              {f.asap ? 'ASAP / NOW' : 'Scheduled time'}
            </button>
          </div>
          {!f.asap ? (
            <>
              <Field label="Date"><input id="jf-date" type="date" value={f.date} onChange={set('date')} /></Field>
              <Field label={f.endTime ? 'Arrive from' : 'Time'}><input id="jf-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value, endTime: f.endTime && f.endTime <= e.target.value ? '' : f.endTime })} /></Field>
              {windows ? <Field label="Until (optional)"><input id="jf-end" type="time" value={f.endTime} onChange={set('endTime')} /></Field> : null}
            </>
          ) : null}
          {!f.asap && windows ? (
            <div className="field span-all">
              <span className="flabel">Arrival window</span>
              <div className="chips">
                {WINDOWS.map(([a, b]) => (
                  <button key={a} type="button" className={'chip' + (f.time === a && f.endTime === b ? ' on' : '')} onClick={() => setF({ ...f, time: a, endTime: b })}>{fmtSpan(new Date(`2000-01-01T${a}:00`), new Date(`2000-01-01T${b}:00`))}</button>
                ))}
                <button type="button" className={'chip' + (f.time && !f.endTime ? ' on' : '')} onClick={() => setF({ ...f, endTime: '' })}>Exact time</button>
              </div>
              {f.endTime && f.time && f.endTime <= f.time ? <span className="fhint">The end time has to be after the start time.</span> : null}
            </div>
          ) : null}
          <Field label="Technician">
            <select id="jf-tech" value={f.techId} onChange={set('techId')}>
              <option value="">Unassigned</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Estimate ($)">
            <input id="jf-est" type="number" inputMode="decimal" step="0.01" min="0" className="mono" value={f.estimate} onChange={set('estimate')} placeholder="150" />
          </Field>
        </div>
        {techs.length === 0 ? <p className="fhint">No technicians yet. Have your locksmith create an account, then set their role to Technician under Team.</p> : null}
      </fieldset>

      <fieldset>
        <legend>Lock, key and notes</legend>
        <div className="grid">
          <Field label="Lock / key details" wide><textarea id="jf-lock" rows={2} value={f.lockDetails} onChange={set('lockDetails')} placeholder="Schlage SC1, 2 keys, high security…" /></Field>
          <Field label="Dispatcher notes (office only)"><textarea id="jf-dn" rows={2} value={f.dispatcherNotes} onChange={set('dispatcherNotes')} /></Field>
          <Field label="Notes for technician"><textarea id="jf-tn" rows={2} value={f.techNotes} onChange={set('techNotes')} /></Field>
        </div>
      </fieldset>

      <div className="form-foot">
        <button type="button" className="btn ghost" onClick={() => history.back()}>Cancel</button>
        <button className="btn primary big" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Create job'}</button>
      </div>
    </form>
  )
}
