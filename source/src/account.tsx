import React, { useState } from 'react'
import { sb, errText } from './db'
import { useStore } from './store'
import { Field, Modal } from './ui'
import { approvalEnabled, deleteMyAccount, titleCase, updateMyProfile } from './model'

export function AccountModal({ onClose }: { onClose: () => void }) {
  const { me, email, toast, reload } = useStore()
  const [name, setName] = useState(me?.name || '')
  const [phone, setPhone] = useState(me?.phone || '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [delStep, setDelStep] = useState(0)
  const [delText, setDelText] = useState('')

  return (
    <Modal title="Account" onClose={onClose}>
      <div className="small muted">{email}{me ? ` · ${titleCase(me.role)}` : ''}</div>
      <Field label="Name"><input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Phone"><input id="ac-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <button className="btn full" disabled={busy} onClick={async () => {
        if (!me) return
        setBusy(true); setErr('')
        try { await updateMyProfile(me.id, { name: name.trim(), phone: phone.trim() }); toast('Saved'); reload() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
      }}>Save details</button>

      <div className="divider" />
      <Field label="New password"><input id="ac-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Repeat new password"><input id="ac-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <button className="btn full" disabled={busy || pw.length < 8 || pw !== pw2} onClick={async () => {
        setBusy(true); setErr('')
        const { error } = await sb.auth.updateUser({ password: pw })
        setBusy(false)
        if (error) setErr(errText(error)); else { setPw(''); setPw2(''); toast('Password changed') }
      }}>Change password</button>
      {pw && pw.length < 8 ? <span className="fhint">At least 8 characters.</span> : pw2 && pw !== pw2 ? <span className="fhint">Passwords don't match.</span> : null}

      {err ? <div className="alert err">{err}</div> : null}

      <div className="divider" />
      <button className="btn full" onClick={() => sb.auth.signOut()}>Sign out</button>

      {approvalEnabled() ? (
        delStep === 0 ? (
          <button className="link small danger-link" onClick={() => setDelStep(1)}>Delete my account</button>
        ) : (
          <div className="danger-box">
            <p className="small">This permanently deletes your LockDesk login. Jobs you worked on stay in the company records. Type <strong>DELETE</strong> to confirm.</p>
            <input id="ac-del" value={delText} onChange={(e) => setDelText(e.target.value)} autoCapitalize="characters" />
            <button className="btn danger full" disabled={busy || delText.trim().toUpperCase() !== 'DELETE'} onClick={async () => {
              setBusy(true); setErr('')
              try { await deleteMyAccount(); await sb.auth.signOut() } catch (e: any) { setErr(e.message); setBusy(false) }
            }}>Delete my account</button>
            <button className="btn ghost full" onClick={() => { setDelStep(0); setDelText('') }}>Keep my account</button>
          </div>
        )
      ) : null}
    </Modal>
  )
}

export function PendingScreen({ mark }: { mark: React.ReactNode }) {
  const { reload, email, me } = useStore()
  const [checking, setChecking] = useState(false)
  const [acct, setAcct] = useState(false)
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand big">{mark} LockDesk</div>
        <h2 className="pending-h">Waiting for approval</h2>
        <p>Thanks{me?.name && me.name !== email ? `, ${me.name.split(' ')[0]}` : ''}. Your account ({email}) was sent to the owner. You'll get access as soon as they approve it.</p>
        <button className="btn primary full big" disabled={checking} onClick={async () => { setChecking(true); await reload(); setChecking(false) }}>{checking ? 'Checking…' : 'Check again'}</button>
        <button className="btn ghost full" onClick={() => setAcct(true)}>Account</button>
      </div>
      {acct ? <AccountModal onClose={() => setAcct(false)} /> : null}
    </div>
  )
}
