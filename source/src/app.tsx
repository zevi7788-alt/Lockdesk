import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { initClient, sb, scanSchema, errText } from './db'
import { StoreProvider, useStore } from './store'
import { go, useRoute } from './ui'
import { Calendar, CustomerDetail, Customers, Dashboard, JobDetail, JobsList, Reports, SystemCheck } from './dispatch'
import { Team, useTeamAlerts } from './team'
import { AccountModal, PendingScreen } from './account'
import { requestPasswordReset } from './model'
import { InstallHint } from './install'
import { logError } from './backup'
import { InvoiceDetail, InvoicesPage, PublicInvoice, SettingsPage } from './invoices'
import { JobFormPage } from './jobform'
import { TechHome, TechJob } from './tech'

// ---------------- Login ----------------

function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw })
        if (error) throw error
      } else if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({
          email: email.trim(), password: pw,
          options: { data: { full_name: name.trim(), name: name.trim() }, emailRedirectTo: location.origin + location.pathname },
        })
        if (error) throw error
        if (!data.session) setMsg('Request sent. The owner has to approve your account before you can sign in.')
      } else {
        const how = await requestPasswordReset(email)
        setMsg(how === 'owner'
          ? 'Request sent to the owner. They will set a temporary password and send it to you.'
          : 'If that email has an account, a reset link is on its way.')
      }
    } catch (e: any) {
      setErr(errText(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big"><Mark /> LockDesk</div>
        <p className="muted">{mode === 'in' ? 'Sign in to dispatch' : mode === 'up' ? 'Request access. The owner approves every account.' : 'Forgot your password? The owner will reset it for you.'}</p>
        {mode === 'up' ? (
          <label className="field"><span className="flabel">Full name</span><input id="lg-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
        ) : null}
        <label className="field"><span className="flabel">Email</span><input id="lg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        {mode !== 'reset' ? (
          <label className="field"><span className="flabel">Password</span><input id="lg-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={mode === 'up' ? 8 : 6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
        ) : null}
        {err ? <div className="alert err">{err}</div> : null}
        {msg ? <div className="alert ok">{msg}</div> : null}
        <button className="btn primary full big" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Request access' : 'Ask the owner to reset it'}</button>
        <InstallHint />
        <div className="login-links">
          {mode !== 'in' ? <button type="button" className="link" onClick={() => setMode('in')}>Back to sign in</button> : (
            <>
              <button type="button" className="link" onClick={() => setMode('up')}>Request access</button>
              <button type="button" className="link" onClick={() => setMode('reset')}>Forgot password</button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}

function NewPassword({ done }: { done: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="login">
      <form className="login-card" onSubmit={async (e) => {
        e.preventDefault()
        const { error } = await sb.auth.updateUser({ password: pw })
        if (error) setErr(errText(error)); else done()
      }}>
        <div className="brand big"><Mark /> LockDesk</div>
        <p className="muted">Choose a new password</p>
        <label className="field"><span className="flabel">New password</span><input id="np-pw" type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err ? <div className="alert err">{err}</div> : null}
        <button className="btn primary full big">Save password</button>
      </form>
    </div>
  )
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="10" width="18" height="12" rx="2" fill="currentColor" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2.4" fill="none" />
      <circle cx="12" cy="15.5" r="1.8" fill="var(--bg)" />
      <rect x="11.2" y="16" width="1.6" height="3.4" fill="var(--bg)" />
    </svg>
  )
}

// ---------------- Shells ----------------

const NAV = [
  { href: '', label: 'Dispatch', match: (r: string[]) => r.length === 0 },
  { href: 'new', label: 'New job', match: (r: string[]) => r[0] === 'new' },
  { href: 'jobs', label: 'Jobs', match: (r: string[]) => r[0] === 'jobs' },
  { href: 'calendar', label: 'Calendar', match: (r: string[]) => r[0] === 'calendar' },
  { href: 'customers', label: 'Customers', match: (r: string[]) => r[0] === 'customers' },
  { href: 'invoices', label: 'Invoices', match: (r: string[]) => r[0] === 'invoices' || r[0] === 'settings' },
  { href: 'reports', label: 'Reports', match: (r: string[]) => r[0] === 'reports' },
  { href: 'team', label: 'Team', match: (r: string[]) => r[0] === 'team' },
]

function OfficeShell({ onTechView }: { onTechView: () => void }) {
  const r = useRoute()
  const { me, email, error, live, jobs } = useStore()
  const [menu, setMenu] = useState(false)
  const [acct, setAcct] = useState(false)
  const teamAlerts = useTeamAlerts()
  const unpaid = jobs.filter((j) => j.status === 'completed' && j.payStatus !== 'paid' && j.payStatus !== 'voided' && j.payStatus !== 'refunded').length

  let page: React.ReactNode
  if (r[0] === 'new') page = <NewJobRoute />
  else if (r[0] === 'jobs' && r[1] === 'filter') page = <JobsList filter={r[2]} />
  else if (r[0] === 'jobs' && r[1] && r[2] === 'edit') page = <EditJobRoute id={r[1]} />
  else if (r[0] === 'jobs' && r[1]) page = <JobDetail id={r[1]} />
  else if (r[0] === 'jobs') page = <JobsList />
  else if (r[0] === 'customers' && r[1]) page = <CustomerDetail id={r[1]} />
  else if (r[0] === 'customers') page = <Customers />
  else if (r[0] === 'invoices' && r[1] === 'filter') page = <InvoicesPage filter={r[2]} />
  else if (r[0] === 'invoices' && r[1]) page = <InvoiceDetail id={r[1]} />
  else if (r[0] === 'invoices') page = <InvoicesPage />
  else if (r[0] === 'settings') page = <SettingsPage />
  else if (r[0] === 'calendar') page = <Calendar />
  else if (r[0] === 'reports') page = <Reports />
  else if (r[0] === 'team') page = <Team />
  else if (r[0] === 'system') page = <SystemCheck />
  else page = <Dashboard />

  return (
    <div className={'shell' + (menu ? ' menu-open' : '')}>
      <aside className="side">
        <div className="brand"><Mark /> LockDesk</div>
        <nav onClick={() => setMenu(false)}>
          {NAV.map((n) => (
            <a key={n.href} href={'#/' + n.href} className={n.match(r) ? 'on' : ''}>
              {n.label}
              {n.href === 'jobs' && unpaid ? <span className="nav-n">{unpaid}</span> : null}
              {n.href === 'team' && teamAlerts ? <span className="nav-n alert">{teamAlerts}</span> : null}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me"><strong>{me?.name || email}</strong><span className="muted">{me ? me.role.charAt(0).toUpperCase() + me.role.slice(1) : ''}</span></div>
          <div className={'live' + (live ? ' on' : '')}>{live ? 'Live' : 'Connecting'}</div>
          <button className="link small" onClick={onTechView}>Technician view</button>
          <a className="link small" href="#/system" onClick={() => setMenu(false)}>System check</a>
          <button className="link small" onClick={() => { setMenu(false); setAcct(true) }}>Account</button>
          <button className="link small" onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
        <div className="brand"><Mark /> LockDesk</div>
        <a className="btn primary sm" href="#/new">+ Job</a>
      </div>
      <div className="scrim" onClick={() => setMenu(false)} />
      <main className="main">
        {error ? <div className="alert err banner">Could not load data: {error} <a href="#/system">System check</a></div> : null}
        {me === null && !error ? null : null}
        {page}
      </main>
      {acct ? <AccountModal onClose={() => setAcct(false)} /> : null}
    </div>
  )
}

function NewJobRoute() {
  const { customers } = useStore()
  // Prefill when coming from a customer's page
  const [key] = useState(() => {
    const id = sessionStorage.getItem('lockdesk.prefill')
    sessionStorage.removeItem('lockdesk.prefill')
    return id
  })
  const c = key ? customers.find((x) => x.id === key) : undefined
  return <JobFormPage key={key || 'new'} prefill={c} />
}

function EditJobRoute({ id }: { id: string }) {
  const { jobs } = useStore()
  const j = jobs.find((x) => x.id === id)
  if (!j) return <div className="page"><div className="loading">Loading job…</div></div>
  return <JobFormPage existing={j} key={j.id} />
}

function TechShell({ canSwitch, onOffice }: { canSwitch: boolean; onOffice: () => void }) {
  const r = useRoute()
  const { live, me } = useStore()
  const [acct, setAcct] = useState(false)
  const jobId = r[0] === 'job' ? r[1] : null
  return (
    <div className="tech-shell">
      <header className="tech-top">
        <div className="brand"><Mark /> LockDesk</div>
        <div className="tech-top-r">
          <span className={'live' + (live ? ' on' : '')}>{live ? 'Live' : '…'}</span>
          {canSwitch ? <button className="btn ghost sm" onClick={onOffice}>Office</button> : null}
          <button className="btn ghost sm" onClick={() => setAcct(true)}>Account</button>
        </div>
      </header>
      {acct ? <AccountModal onClose={() => setAcct(false)} /> : null}
      {me && me.role !== 'technician' && !canSwitch ? null : null}
      {jobId ? <TechJob id={jobId} back={() => go('')} /> : <TechHome openJob={(id) => go('job/' + id)} />}
    </div>
  )
}

function Router() {
  const { me, loading, email, error } = useStore()
  const [techView, setTechView] = useState(() => { try { return localStorage.getItem('lockdesk.techview') === '1' } catch { return false } })
  const setTV = (v: boolean) => { setTechView(v); try { localStorage.setItem('lockdesk.techview', v ? '1' : '0') } catch {}; go('') }
  if (loading && !me) return <div className="splash"><Mark /><span>Loading LockDesk…</span></div>
  if (!me) {
    return (
      <div className="login"><div className="login-card">
        <div className="brand big"><Mark /> LockDesk</div>
        <p>Signed in as {email}, but no staff profile was found for this account.</p>
        {error ? <div className="alert err">{error}</div> : null}
        <p className="muted small">The database creates a profile automatically when an account is made. If this persists, open System check or ask the owner.</p>
        <a className="btn full" href="#/system" onClick={() => setTV(false)}>System check</a>
        <button className="btn ghost full" onClick={() => sb.auth.signOut()}>Sign out</button>
      </div></div>
    )
  }
  if (!me.approved) return <PendingScreen mark={<Mark />} />
  if (me.role === 'technician') return <TechShell canSwitch={false} onOffice={() => {}} />
  if (techView) return <TechShell canSwitch onOffice={() => setTV(false)} />
  return <OfficeShell onTechView={() => setTV(true)} />
}

// ---------------- Root ----------------

type Toast = { id: number; msg: string; kind: 'ok' | 'err' }

function App() {
  const [session, setSession] = useState<any>(undefined)
  const [ready, setReady] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    if (kind === 'err') logError(msg)
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3200)
  }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }: any) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((ev: string, s: any) => {
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) { setReady(false); return }
    setScanErr('')
    scanSchema().then(() => setReady(true)).catch((e) => setScanErr(errText(e)))
  }, [uid])

  let body: React.ReactNode
  if (session === undefined) body = <div className="splash"><Mark /><span>Loading LockDesk…</span></div>
  else if (recovery && session) body = <NewPassword done={() => { setRecovery(false); toast('Password updated') }} />
  else if (!session) body = <Login />
  else if (scanErr) body = <div className="login"><div className="login-card"><div className="brand big"><Mark /> LockDesk</div><div className="alert err">Could not reach the database: {scanErr}</div><button className="btn full" onClick={() => location.reload()}>Try again</button><button className="btn ghost full" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>
  else if (!ready) body = <div className="splash"><Mark /><span>Connecting to your database…</span></div>
  else body = (
    <StoreProvider userId={uid} email={session.user.email} onToast={toast}>
      <Router />
    </StoreProvider>
  )

  return (
    <>
      {body}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
      </div>
    </>
  )
}

function boot() {
  const root = createRoot(document.getElementById('root')!)
  // Customer invoice links work without signing in
  const pub = location.hash.match(/^#\/i\/([a-f0-9]{24,})/i)
  if (!window.supabase) {
    root.render(
      <div className="login"><div className="login-card">
        <div className="brand big">LockDesk</div>
        <div className="alert err">Could not load the connection library. Check your internet connection and reload.</div>
        <button className="btn full" onClick={() => location.reload()}>Reload</button>
      </div></div>,
    )
    return
  }
  initClient()
  root.render(pub ? <PublicInvoice token={pub[1]} /> : <App />)
}

boot()
