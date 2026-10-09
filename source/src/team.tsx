import React, { useState } from 'react'
import { useStore } from './store'
import { Empty, Field, Modal } from './ui'
import { SetupScript } from './setup'
import {
  Profile, Role, approvalEnabled, approveUser, createMember, dismissRequest, fmtDateTime, removeUser, setRole,
  setUserPassword, tempPassword, titleCase,
} from './model'

const ROLES: Role[] = ['technician', 'dispatcher', 'owner']

function PasswordModal({ person, email, onClose }: { person: { id: string; name: string }; email: string; onClose: () => void }) {
  const { toast, reload } = useStore()
  const [pw, setPw] = useState(tempPassword)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(`LockDesk sign in\nEmail: ${email}\nTemporary password: ${pw}`); toast('Copied') } catch {} }
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

function AddMemberModal({ onClose }: { onClose: () => void }) {
  const { toast, reload } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRoleSel] = useState<Role>('technician')
  const [pw, setPw] = useState(tempPassword)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(`LockDesk sign in\nEmail: ${email.trim()}\nTemporary password: ${pw}`); toast('Copied') } catch {} }
  return (
    <Modal title="Add team member" onClose={onClose}>
      {!done ? (
        <>
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
            try { await createMember({ name, email, password: pw, role }); setDone(true); reload() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
          }}>{busy ? 'Creating…' : 'Create and approve'}</button>
        </>
      ) : (
        <>
          <div className="alert ok">{name} is set up as {titleCase(role)}. Send them their sign in details:</div>
          <div className="cred mono"><div>{email.trim()}</div><div>{pw}</div></div>
          <button className="btn full" onClick={copy}>Copy sign in details</button>
          <button className="btn primary full" onClick={onClose}>Done</button>
        </>
      )}
    </Modal>
  )
}

export function Team() {
  const { profiles, me, toast, reload, accounts, requests } = useStore()
  const owner = me?.role === 'owner' && me.approved
  const enabled = approvalEnabled()
  const [pwFor, setPwFor] = useState<{ id: string; name: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [roleFor, setRoleFor] = useState<Record<string, Role>>({})
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState('')

  const emailOf = (p: Profile) => accounts.get(p.id)?.email || p.email
  const isRemoved = (p: Profile) => accounts.get(p.id)?.removed === true
  const pending = profiles.filter((p) => !p.approved && !isRemoved(p))
  const removed = profiles.filter((p) => !p.approved && isRemoved(p))
  const active = profiles.filter((p) => p.approved)

  const act = async (key: string, fn: () => Promise<any>, msg: string) => {
    setBusy(key)
    try { await fn(); toast(msg); setConfirm(null); await reload() } catch (e: any) { toast(e.message || String(e), 'err') } finally { setBusy('') }
  }

  if (!enabled) {
    return (
      <div className="page">
        <div className="page-head"><h1>Team</h1></div>
        <div className="panel warn-panel">
          <h3>Security update needed</h3>
          <SetupScript intro={<>Right now, anyone who creates an account can see your jobs and customers. This update makes every new account wait for your approval, and lets you manage passwords from here.</>} />
        </div>
        <div className="list">
          {profiles.map((p) => (
            <div key={p.id} className="list-row static">
              <div><strong>{p.name}</strong>{p.id === me?.id ? <span className="muted"> (you)</span> : null}</div>
              <span className={'badge role-' + p.role}>{titleCase(p.role)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Team</h1>
        {owner ? <button className="btn primary" onClick={() => setAdding(true)}>+ Add member</button> : null}
      </div>
      {!owner ? <p className="muted small">Only the owner can approve accounts or reset passwords.</p> : null}

      {owner ? (
        <section className="section">
          <div className="section-head"><h2>Waiting for approval<span className="count">{pending.length}</span></h2></div>
          {pending.length === 0 ? <Empty>No one is waiting. New sign ups show up here.</Empty> : (
            <div className="list">
              {pending.map((p) => {
                const r = roleFor[p.id] || 'technician'
                const info = accounts.get(p.id)
                return (
                  <div key={p.id} className="list-row static stack">
                    <div>
                      <strong>{p.name}</strong>
                      <div className="sub">{emailOf(p)}{info?.createdAt ? ` · signed up ${fmtDateTime(info.createdAt)}` : ''}</div>
                    </div>
                    <div className="row-actions">
                      <select id={'ap-role-' + p.id} value={r} onChange={(e) => setRoleFor({ ...roleFor, [p.id]: e.target.value as Role })}>
                        {ROLES.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                      </select>
                      <button className="btn primary" disabled={!!busy} onClick={() => act('ap' + p.id, () => approveUser(p.id, r), `${p.name} approved as ${titleCase(r)}`)}>Approve</button>
                      {confirm === 'deny' + p.id ? (
                        <button className="btn danger" disabled={!!busy} onClick={() => act('dn' + p.id, () => removeUser(p.id), `${p.name} denied`)}>Confirm deny</button>
                      ) : <button className="btn ghost" onClick={() => setConfirm('deny' + p.id)}>Deny</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
        <div className="section-head"><h2>Team<span className="count">{active.length}</span></h2></div>
        <div className="list">
          {active.map((p) => (
            <div key={p.id} className="list-row static stack">
              <div>
                <strong>{p.name}</strong>{p.id === me?.id ? <span className="muted"> (you)</span> : null}
                <div className="sub">{[emailOf(p), p.phone].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="row-actions">
                {owner && p.id !== me?.id ? (
                  <>
                    <select id={'role-' + p.id} value={p.role} onChange={(e) => act('rl' + p.id, () => setRole(p, e.target.value as Role), `${p.name} is now ${titleCase(e.target.value)}`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                    </select>
                    <button className="btn" onClick={() => setPwFor({ id: p.id, name: p.name })}>Password</button>
                    {confirm === 'rm' + p.id ? (
                      <button className="btn danger" disabled={!!busy} onClick={() => act('rm' + p.id, () => removeUser(p.id), `${p.name} removed`)}>Confirm remove</button>
                    ) : <button className="btn ghost" onClick={() => setConfirm('rm' + p.id)}>Remove</button>}
                  </>
                ) : <span className={'badge role-' + p.role}>{titleCase(p.role)}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {owner && removed.length ? (
        <section className="section">
          <div className="section-head"><h2>Removed<span className="count">{removed.length}</span></h2></div>
          <div className="list">
            {removed.map((p) => (
              <div key={p.id} className="list-row static">
                <div><strong>{p.name}</strong><div className="sub">{emailOf(p)}</div></div>
                <button className="btn" onClick={() => act('rs' + p.id, () => approveUser(p.id, p.role), `${p.name} restored`)}>Restore</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {pwFor ? <PasswordModal person={pwFor} email={accounts.get(pwFor.id)?.email || ''} onClose={() => setPwFor(null)} /> : null}
      {adding ? <AddMemberModal onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

// Number shown on the Team nav item for the owner
export function useTeamAlerts() {
  const { profiles, me, accounts, requests } = useStore()
  if (!(me?.role === 'owner' && me.approved) || !approvalEnabled()) return 0
  return profiles.filter((p) => !p.approved && accounts.get(p.id)?.removed !== true).length + requests.length
}
