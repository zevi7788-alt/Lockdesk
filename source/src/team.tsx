import { APP_NAME } from './brand'
import React, { useCallback, useEffect, useState } from 'react'
import { useStore } from './store'
import { Empty, Field, Modal } from './ui'
import { SetupScript } from './setup'
import {
  DeviceRow, Profile, Role, approvalEnabled, createMember, deactivateUser, denyUser, deviceLinkUrl, dismissRequest,
  fmtDateTime, listDevices, newDeviceLink, reactivateUser, revokeDevice, setRole, setUserPassword, tempPassword, titleCase,
} from './model'

const ROLES: Role[] = ['technician', 'dispatcher', 'owner']

function PasswordModal({ person, email, onClose }: { person: { id: string; name: string }; email: string; onClose: () => void }) {
  const { toast, reload } = useStore()
  const [pw, setPw] = useState(tempPassword)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(`${APP_NAME} sign in\nEmail: ${email}\nTemporary password: ${pw}`); toast('Copied') } catch {} }
  return (
    <Modal title={`New password · ${person.name}`} onClose={onClose}>
      {!done ? (
        <>
          <p className="small muted">Set a temporary password, then text it to them. They can change it under Account after signing in.</p>
          <Field label="Temporary password"><input id="pw-new" className="mono big-input" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err ? <div className="alert err">{err}</div> : null}
          <button className="btn primary full big" disabled={busy || pw.length < 8} onClick={async () => {
            setBusy(true); setErr('')
            try { await setUserPassword(person.id, pw); setDone(true); reload() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
          }}>{busy ? 'Saving…' : 'Set password'}</button>
        </>
      ) : (
        <>
          <div className="alert ok">Password updated. Send it to {person.name}:</div>
          <div className="cred mono"><div>{email}</div><div>{pw}</div></div>
          <button className="btn full" onClick={copy}>Copy sign in details</button>
          <button className="btn primary full" onClick={onClose}>Done</button>
        </>
      )}
    </Modal>
  )
}


// Shows a one time device link with easy ways to send it.
function LinkModal({ who, token, password, onClose }: { who: { name: string; email: string }; token: string; password?: string; onClose: () => void }) {
  const { toast } = useStore()
  const url = deviceLinkUrl(token)
  const first = who.name.split(' ')[0] || who.name
  const msg = `${APP_NAME} setup for ${first}\n\nOpen this link on YOUR phone only (it works one time, on the first phone that opens it):\n${url}\n\nThen sign in with:\nEmail: ${who.email}${password ? `\nTemporary password: ${password}` : ''}`
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(what + ' copied') } catch { toast('Could not copy. Press and hold to copy instead.', 'err') } }
  const canShare = typeof (navigator as any).share === 'function'
  return (
    <Modal title={`Phone link · ${who.name}`} onClose={onClose}>
      <div className="alert ok">Send this to {first}. It works <strong>one time</strong>, on the first phone that opens it, and expires in 3 days.</div>
      <div className="cred mono link-box">{url}</div>
      {password ? <div className="cred mono"><div>{who.email}</div><div>{password}</div></div> : null}
      {canShare ? <button className="btn primary full big" onClick={() => (navigator as any).share({ title: `${APP_NAME} setup`, text: msg }).catch(() => {})}>Send…</button> : null}
      <a className={'btn full' + (canShare ? '' : ' primary big')} href={`sms:?&body=${encodeURIComponent(msg)}`}>Text it</a>
      <button className="btn full" onClick={() => copy(msg, 'Message')}>Copy message</button>
      <p className="small muted">If they open it on the wrong phone, or get a new phone later, just make a new link. Their old phone stops working the moment the new one is set up.</p>
      <button className="btn ghost full" onClick={onClose}>Done</button>
    </Modal>
  )
}

function AddMemberModal({ onClose, onLink }: { onClose: () => void; onLink: (v: { who: { name: string; email: string }; token: string; password: string }) => void }) {
  const { reload } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRoleSel] = useState<Role>('technician')
  const [pw, setPw] = useState(tempPassword)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add team member" onClose={onClose}>
      <p className="small muted">Only you can create accounts. After this you'll get a one time link for their phone.</p>
      <Field label="Full name"><input id="am-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Email"><input id="am-email" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="field">
        <span className="flabel">Role</span>
        <div className="seg">{ROLES.map((r) => <button key={r} type="button" className={role === r ? 'on' : ''} onClick={() => setRoleSel(r)}>{titleCase(r)}</button>)}</div>
      </div>
      <Field label="Temporary password"><input id="am-pw" className="mono" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn primary full big" disabled={busy || !name.trim() || !email.trim()} onClick={async () => {
        setBusy(true); setErr('')
        try {
          const id = await createMember({ name, email, password: pw, role })
          const token = await newDeviceLink(id)
          reload()
          onLink({ who: { name: name.trim(), email: email.trim() }, token, password: pw })
        } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
      }}>{busy ? 'Creating…' : 'Create account and phone link'}</button>
    </Modal>
  )
}

const ago = (d: Date | null) => {
  if (!d) return 'not used yet'
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  return m < 2 ? 'active now' : m < 60 ? `used ${m} min ago` : m < 1440 ? `used ${Math.round(m / 60)} hr ago` : `used ${fmtDateTime(d)}`
}

export function Team() {
  const { profiles, me, toast, reload, accounts, requests } = useStore()
  const owner = me?.role === 'owner' && me.approved
  const enabled = approvalEnabled()
  const [pwFor, setPwFor] = useState<{ id: string; name: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState<{ who: { name: string; email: string }; token: string; password?: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [reRole, setReRole] = useState<Record<string, Role>>({})

  const loadDevices = useCallback(() => { listDevices().then(setDevices).catch(() => {}) }, [])
  useEffect(() => { if (owner) loadDevices() }, [owner, profiles.length, loadDevices])

  const emailOf = (p: Profile) => accounts.get(p.id)?.email || p.email || ''
  const isOff = (p: Profile) => accounts.get(p.id)?.removed === true
  const pending = profiles.filter((p) => !p.approved && !isOff(p))
  const deactivated = profiles.filter((p) => !p.approved && isOff(p))
  const active = profiles.filter((p) => p.approved)

  const act = async (key: string, fn: () => Promise<any>, msg: string) => {
    setBusy(key)
    try { await fn(); if (msg) toast(msg); setConfirm(null); await reload(); loadDevices() } catch (e: any) { toast(e.message || String(e), 'err') } finally { setBusy('') }
  }
  const makeLink = (p: Profile) => act('lk' + p.id, async () => {
    const token = await newDeviceLink(p.id)
    setLink({ who: { name: p.name, email: emailOf(p) }, token })
  }, '')

  if (!enabled) {
    return (
      <div className="page">
        <div className="page-head"><h1>Team</h1></div>
        <div className="panel warn-panel"><h3>Security update needed</h3><SetupScript intro={<>Run the latest database update to turn on owner created accounts.</>} /></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Team</h1>
        {owner ? <button className="btn primary" onClick={() => setAdding(true)}>+ Add member</button> : null}
      </div>
      {owner ? (
        <div className="panel security-note">
          <strong>How access works</strong>
          <p className="small">Only you create accounts. Each account works only on the phone its setup link was opened on. Deactivate someone and every device they have stops working right away.</p>
        </div>
      ) : <p className="muted small">Only the owner can add people, make phone links or reset passwords.</p>}

      {owner && pending.length ? (
        <section className="section">
          <div className="section-head"><h2>Old sign ups<span className="count">{pending.length}</span></h2></div>
          <p className="small muted">Accounts made before sign ups were closed. They can't get in. Delete them, or make them a phone link to let them in.</p>
          <div className="list">
            {pending.map((p) => (
              <div key={p.id} className="list-row static stack">
                <div><strong>{p.name}</strong><div className="sub">{emailOf(p)}</div></div>
                <div className="row-actions">
                  <button className="btn" disabled={!!busy} onClick={() => act('re' + p.id, async () => { const token = await reactivateUser(p.id, 'technician'); setLink({ who: { name: p.name, email: emailOf(p) }, token }) }, '')}>Let in as technician</button>
                  {confirm === 'deny' + p.id
                    ? <button className="btn danger" disabled={!!busy} onClick={() => act('dn' + p.id, () => denyUser(p.id), `${p.name} deleted`)}>Confirm delete</button>
                    : <button className="btn ghost" onClick={() => setConfirm('deny' + p.id)}>Delete</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {owner && requests.length ? (
        <section className="section">
          <div className="section-head"><h2>Password reset requests<span className="count">{requests.length}</span></h2></div>
          <div className="list">
            {requests.map((q) => {
              const p = profiles.find((x) => x.id === q.userId)
              return (
                <div key={q.id} className="list-row static stack">
                  <div><strong>{p?.name || q.email}</strong><div className="sub">{q.email}{q.createdAt ? ` · ${fmtDateTime(q.createdAt)}` : ''}</div></div>
                  <div className="row-actions">
                    <button className="btn primary" onClick={() => setPwFor({ id: q.userId, name: p?.name || q.email })}>Set new password</button>
                    <button className="btn ghost" onClick={() => act('dq' + q.id, () => dismissRequest(q.id), 'Request dismissed')}>Dismiss</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head"><h2>Active<span className="count">{active.length}</span></h2></div>
        <div className="list">
          {active.map((p) => {
            const mine = devices.filter((d) => d.userId === p.id)
            const devs = mine.filter((d) => d.kind === 'device')
            const open = mine.find((d) => d.kind === 'link')
            const self = p.id === me?.id
            return (
              <div key={p.id} className="list-row static stack member">
                <div className="member-head">
                  <div>
                    <strong>{p.name}</strong>{self ? <span className="muted"> (you)</span> : null}
                    <div className="sub">{[emailOf(p), p.phone].filter(Boolean).join(' · ')}</div>
                  </div>
                  {owner && !self ? (
                    <select id={'role-' + p.id} value={p.role} onChange={(e) => act('rl' + p.id, () => setRole(p, e.target.value as Role), `${p.name} is now ${titleCase(e.target.value)}`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                    </select>
                  ) : <span className={'badge role-' + p.role}>{titleCase(p.role)}</span>}
                </div>
                {owner ? (
                  <>
                    <div className="devices">
                      {devs.length === 0 && !open ? <div className="device none">No phone set up yet. They can't sign in until you send a phone link.</div> : null}
                      {devs.map((d) => (
                        <div key={d.id} className="device">
                          <span className="dot on" /> <span className="dlabel">{d.label}</span><span className="muted small">{ago(d.lastSeen)}</span>
                          {confirm === 'rv' + d.id
                            ? <button className="btn danger sm" disabled={!!busy} onClick={() => act('rv' + d.id, () => revokeDevice(d.id), 'Device turned off')}>Confirm</button>
                            : <button className="link small danger-link" onClick={() => setConfirm('rv' + d.id)}>Turn off</button>}
                        </div>
                      ))}
                      {open ? (
                        <div className="device">
                          <span className="dot wait" /> <span className="dlabel">Setup link sent, not opened yet</span><span className="muted small">expires {fmtDateTime(open.expiresAt!)}</span>
                          <button className="link small danger-link" onClick={() => act('cx' + open.id, () => revokeDevice(open.id), 'Link cancelled')}>Cancel link</button>
                        </div>
                      ) : null}
                    </div>
                    <div className="row-actions">
                      <button className="btn" disabled={!!busy} onClick={() => makeLink(p)}>{self ? 'Add a device' : devs.length ? 'New phone link' : 'Phone link'}</button>
                      {!self ? <button className="btn" onClick={() => setPwFor({ id: p.id, name: p.name })}>Password</button> : null}
                      {!self ? (confirm === 'off' + p.id
                        ? <button className="btn danger" disabled={!!busy} onClick={() => act('off' + p.id, () => deactivateUser(p.id), `${p.name} deactivated. Their devices no longer work.`)}>Confirm deactivate</button>
                        : <button className="btn ghost danger-text" onClick={() => setConfirm('off' + p.id)}>Deactivate</button>) : null}
                    </div>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {owner && deactivated.length ? (
        <section className="section">
          <div className="section-head"><h2>Deactivated<span className="count">{deactivated.length}</span></h2></div>
          <div className="list">
            {deactivated.map((p) => {
              const r = reRole[p.id] || p.role
              return (
                <div key={p.id} className="list-row static stack">
                  <div><strong>{p.name}</strong><div className="sub">{emailOf(p)} · no access</div></div>
                  <div className="row-actions">
                    <select value={r} onChange={(e) => setReRole({ ...reRole, [p.id]: e.target.value as Role })}>{ROLES.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
                    <button className="btn" disabled={!!busy} onClick={() => act('ra' + p.id, async () => { const token = await reactivateUser(p.id, r); setLink({ who: { name: p.name, email: emailOf(p) }, token }) }, `${p.name} reactivated`)}>Reactivate</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {pwFor ? <PasswordModal person={pwFor} email={accounts.get(pwFor.id)?.email || ''} onClose={() => setPwFor(null)} /> : null}
      {adding ? <AddMemberModal onClose={() => setAdding(false)} onLink={(v) => { setAdding(false); setLink(v); loadDevices() }} /> : null}
      {link ? <LinkModal who={link.who} token={link.token} password={link.password} onClose={() => { setLink(null); loadDevices() }} /> : null}
    </div>
  )
}

// Number shown on the Team nav item for the owner
export function useTeamAlerts() {
  const { me, requests } = useStore()
  if (!(me?.role === 'owner' && me.approved) || !approvalEnabled()) return 0
  return requests.length
}
