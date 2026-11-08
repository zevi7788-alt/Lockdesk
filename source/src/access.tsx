import { APP_NAME, APP_TAGLINE, WEB_URL } from './brand'
import React, { useEffect, useState } from 'react'
import { sb, errText } from './db'
import { Brand } from './ui'
import { Icon } from './icons'
import { deviceStatus, enrollDevice, getDeviceSecret, isIOS, isStandalone, requestPasswordReset } from './model'

const Legal = () => (
  <div className="legal-links"><a href={WEB_URL + 'privacy.html'} target="_blank" rel="noreferrer">Privacy policy</a><a href={WEB_URL + 'support.html'} target="_blank" rel="noreferrer">Support</a></div>
)

// What anyone with the web address sees: what LockDesk is, and no way in.
export function Landing({ notice }: { notice?: string }) {
  const features: [string, string, string][] = [
    ['dispatch', 'Live dispatch board', 'Every job, technician and arrival window in one place, updating in real time.'],
    ['jobs', 'Technician app', 'Techs see only their own jobs, with big buttons for on the way, arrived and done.'],
    ['invoices', 'Invoices and payments', 'Automatic invoices with sales tax, paid receipts, cards, cash, check and Zelle.'],
    ['team', 'Locked to your team', 'Accounts are created by the owner and only work on phones the owner set up.'],
  ]
  return (
    <div className="landing">
      <header className="landing-top"><Brand big /></header>
      <main className="landing-main">
        <p className="landing-kicker">{APP_TAGLINE}</p>
        <h1 className="landing-h">Dispatch software for the {APP_TAGLINE} team</h1>
        <p className="landing-lede">{APP_NAME} runs the office and the field: scheduling, dispatch, the technician app, invoices and payments.</p>
        {notice ? <div className="alert err landing-notice">{notice}</div> : null}
        <div className="landing-lock">
          <Icon name="team" />
          <div>
            <strong>Private system. Invitation only.</strong>
            <p>There is no sign up. If you work for {APP_TAGLINE}, the owner will create your account and send you a personal setup link for your phone.</p>
          </div>
        </div>
        <div className="landing-grid">
          {features.map(([ic, t, d]) => (
            <div key={t} className="landing-card"><Icon name={ic} /><strong>{t}</strong><p>{d}</p></div>
          ))}
        </div>
      </main>
      <footer className="landing-foot"><Legal /></footer>
    </div>
  )
}

// Opened from the owner's one time link on the employee's phone.
export function EnrollScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [phase, setPhase] = useState<'check' | 'ready' | 'busy' | 'err'>('check')
  const [err, setErr] = useState('')
  const [browserOk, setBrowserOk] = useState(false)
  const iosBrowser = isIOS() && !isStandalone()

  useEffect(() => {
    // Opened again from the home screen icon after setup: just continue.
    const s = getDeviceSecret()
    if (!s) { setPhase('ready'); return }
    deviceStatus(s).then((st) => (st.ok ? onDone() : setPhase('ready'))).catch(() => setPhase('ready'))
  }, [])

  const enroll = async () => {
    setPhase('busy'); setErr('')
    try { await enrollDevice(token); onDone() } catch (e: any) { setErr(e.message || String(e)); setPhase('err') }
  }

  if (phase === 'check') return <div className="splash"><span>Checking your setup link…</span></div>

  return (
    <div className="login"><div className="login-card enroll">
      <Brand big />
      <h1 className="login-h">Set up this phone</h1>
      {phase === 'err' ? (
        <>
          <div className="alert err">{err}</div>
          <p className="muted small">Each setup link works one time, on the first phone that uses it. Ask the owner to send you a new one.</p>
        </>
      ) : iosBrowser && !browserOk ? (
        <>
          <p>This link connects {APP_NAME} to <strong>this phone only</strong>. First put it on your home screen:</p>
          <ol className="steps">
            <li>Tap the <strong>Share</strong> button <span className="muted">(the square with an arrow)</span>.</li>
            <li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            <li>Open <strong>{APP_NAME}</strong> from your home screen to finish setup.</li>
          </ol>
          <p className="muted small">Don't open the link on any other phone. It only works once.</p>
          <button className="link small" onClick={() => setBrowserOk(true)}>Set up in this browser instead</button>
        </>
      ) : (
        <>
          <p>This link connects {APP_NAME} to <strong>this device only</strong>. After this, your account will only work here, and the link stops working.</p>
          <button className="btn primary full big" disabled={phase === 'busy'} onClick={enroll}>{phase === 'busy' ? 'Setting up…' : 'Set up this device'}</button>
        </>
      )}
      <Legal />
    </div></div>
  )
}

// Only shown on a phone the owner set up. The email is fixed to that phone's account.
export function Login({ email, name, error }: { email: string; name?: string; error?: string }) {
  const [mode, setMode] = useState<'in' | 'reset'>('in')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(error || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (error) setErr(error) }, [error])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw })
        if (error) throw error
      } else {
        await requestPasswordReset(email)
        setMsg('Request sent. The owner will set a temporary password and send it to you.')
      }
    } catch (e: any) { setErr(errText(e)) } finally { setBusy(false) }
  }

  const first = name ? name.split(' ')[0] : ''
  return (
    <div className="login split">
      <aside className="login-art" aria-hidden="true">
        <Brand big />
        <div className="login-art-foot">
          <p>Dispatch, field work, invoices and payments in one place.</p>
          <span>Authorized device</span>
        </div>
      </aside>
      <form className="login-card" onSubmit={submit}>
        <Brand big />
        <h1 className="login-h">{mode === 'in' ? (first ? `Welcome back, ${first}` : 'Sign in') : 'Forgot password'}</h1>
        <p className="muted">{mode === 'in' ? 'This device is set up for your account.' : 'The owner will reset it for you.'}</p>
        <label className="field"><span className="flabel">Email</span><input id="lg-email" type="email" value={email} readOnly autoComplete="username" /></label>
        {mode === 'in' ? (
          <label className="field"><span className="flabel">Password</span><input id="lg-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" autoFocus /></label>
        ) : null}
        {err ? <div className="alert err">{err}</div> : null}
        {msg ? <div className="alert ok">{msg}</div> : null}
        <button className="btn primary full big" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Ask the owner to reset it'}</button>
        <div className="login-links">
          {mode === 'in'
            ? <button type="button" className="link" onClick={() => setMode('reset')}>Forgot password</button>
            : <button type="button" className="link" onClick={() => setMode('in')}>Back to sign in</button>}
        </div>
        <Legal />
      </form>
    </div>
  )
}
