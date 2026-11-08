import { APP_NAME, appBase, WEB_URL } from './brand'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { initClient, sb, scanSchema, errText } from './db'
import { OFFLINE, StoreProvider, useStore } from './store'
import { go, useRoute, Brand, Mark } from './ui'
import { Icon } from './icons'
import { Calendar, CustomerDetail, Customers, Dashboard, JobDetail, JobsList, Reports, SystemCheck } from './dispatch'
import { Team, useTeamAlerts } from './team'
import { AccountModal, PendingScreen } from './account'
import { bindSession, deviceStatus, getDeviceSecret, isIOS, isStandalone, setDeviceSecret } from './model'
import { EnrollScreen, Landing, Login } from './access'
import { logError } from './backup'
import { InvoiceDetail, InvoicesPage, PublicInvoice, SettingsPage } from './invoices'
import { JobFormPage } from './jobform'
import { TechHome, TechJob } from './tech'

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
        <Brand big />
        <p className="muted">Choose a new password</p>
        <label className="field"><span className="flabel">New password</span><input id="np-pw" type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err ? <div className="alert err">{err}</div> : null}
        <button className="btn primary full big">Save password</button>
      </form>
    </div>
  )
}

// ---------------- Shells ----------------

const NAV: { group: string; items: { href: string; label: string; icon: string; match: (r: string[]) => boolean }[] }[] = [
  { group: 'Operations', items: [
    { href: '', icon: 'dispatch', label: 'Dispatch', match: (r) => r.length === 0 },
    { href: 'new', icon: 'plus', label: 'New job', match: (r) => r[0] === 'new' },
    { href: 'jobs', icon: 'jobs', label: 'Jobs', match: (r) => r[0] === 'jobs' },
    { href: 'calendar', icon: 'calendar', label: 'Calendar', match: (r) => r[0] === 'calendar' },
  ] },
  { group: 'Records', items: [
    { href: 'customers', icon: 'customers', label: 'Customers', match: (r) => r[0] === 'customers' },
    { href: 'invoices', icon: 'invoices', label: 'Invoices', match: (r) => r[0] === 'invoices' || r[0] === 'settings' },
  ] },
  { group: 'Business', items: [
    { href: 'reports', icon: 'reports', label: 'Reports', match: (r) => r[0] === 'reports' },
    { href: 'team', icon: 'team', label: 'Team', match: (r) => r[0] === 'team' },
  ] },
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
        <Brand />
        <nav onClick={() => setMenu(false)}>
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-label">{g.group}</div>
              {g.items.map((n) => (
                <a key={n.href} href={'#/' + n.href} className={n.match(r) ? 'on' : ''}>
                  <Icon name={n.icon} /><span className="nav-t">{n.label}</span>
                  {n.href === 'jobs' && unpaid ? <span className="nav-n">{unpaid}</span> : null}
                  {n.href === 'team' && teamAlerts ? <span className="nav-n alert">{teamAlerts}</span> : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me">
            <span className="avatar">{(me?.name || email || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="me-text"><strong>{me?.name || email}</strong><span>{me ? me.role.charAt(0).toUpperCase() + me.role.slice(1) : ''}</span></span>
            <span className={'live-dot' + (live ? ' on' : '')} title={live ? 'Live updates on' : 'Connecting'} />
          </div>
          <div className="side-links" onClick={() => setMenu(false)}>
            <button className="side-link" onClick={() => setAcct(true)}><Icon name="user" size={16} />Account</button>
            <button className="side-link" onClick={onTechView}><Icon name="tech" size={16} />Tech view</button>
            <a className="side-link" href="#/system"><Icon name="system" size={16} />System</a>
            <button className="side-link" onClick={() => sb.auth.signOut()}><Icon name="logout" size={16} />Sign out</button>
          </div>
        </div>
      </aside>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
        <Brand tagline={false} />
        <a className="btn accent sm" href="#/new">+ Job</a>
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
        <Brand />
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
  const { me, loading, email, error, reload } = useStore()
  const [techView, setTechView] = useState(() => { try { return localStorage.getItem('lockdesk.techview') === '1' } catch { return false } })
  const setTV = (v: boolean) => { setTechView(v); try { localStorage.setItem('lockdesk.techview', v ? '1' : '0') } catch {}; go('') }
  if (loading && !me) return <div className="splash"><Mark /><span>Loading {APP_NAME}…</span></div>
  if (!me && error === OFFLINE) {
    return (
      <div className="login"><div className="login-card">
        <Brand big />
        <h2 className="pending-h">Can't reach the database</h2>
        <p>Your account is fine. The database service isn't answering right now, so {APP_NAME} will keep retrying on its own.</p>
        <p className="muted small">If this lasts more than a few minutes, the owner should open supabase.com, pick the project and tap Restart project (or Restore project if it says paused). Nothing is lost.</p>
        <button className="btn primary full big" onClick={() => reload()}>Try again now</button>
        <button className="btn ghost full" onClick={() => sb.auth.signOut()}>Sign out</button>
      </div></div>
    )
  }
  if (!me) {
    return (
      <div className="login"><div className="login-card">
        <Brand big />
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

type Dev = { state: 'checking' | 'ok' | 'none' | 'off' | 'offline'; email?: string; name?: string }

function App() {
  const [session, setSession] = useState<any>(undefined)
  const [dev, setDev] = useState<Dev>({ state: 'checking' })
  const [bound, setBound] = useState<string>('')          // session id that is tied to this device
  const [bindErr, setBindErr] = useState('')
  const [ready, setReady] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const route = useRoute()

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    if (kind === 'err') logError(msg)
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3200)
  }, [])

  // Is this phone one the owner set up? Checked at start, every minute, and when the app comes back.
  const checkDevice = useCallback(async () => {
    const secret = getDeviceSecret()
    if (!secret) { setDev({ state: 'none' }); return }
    try {
      const st = await deviceStatus(secret)
      if (st.ok) setDev({ state: 'ok', email: st.email, name: st.name })
      else {
        setDeviceSecret('')
        setDev({ state: 'off' })
        try { await sb.auth.signOut({ scope: 'local' }) } catch {}
      }
    } catch { setDev((d) => (d.state === 'ok' ? d : { state: 'offline' })) }
  }, [])

  useEffect(() => {
    checkDevice()
    const t = setInterval(checkDevice, 60000)
    const vis = () => { if (document.visibilityState === 'visible') checkDevice() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [checkDevice])

  useEffect(() => {
    sb.auth.getSession().then(({ data }: any) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((ev: string, s: any) => {
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Tie each login session to this phone. Without it the database shows nothing.
  const sid = (() => { try { return JSON.parse(atob(String(session?.access_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id || '' } catch { return '' } })()
  useEffect(() => {
    if (!session || dev.state !== 'ok' || !sid || bound === sid) return
    setBindErr('')
    // Someone else's login is still saved here (e.g. the phone was set up for another person): drop it quietly.
    if (dev.email && String(session.user?.email || '').toLowerCase() !== dev.email.toLowerCase()) {
      sb.auth.signOut({ scope: 'local' }).catch(() => {})
      return
    }
    bindSession(getDeviceSecret())
      .then(() => setBound(sid))
      .catch(async (e) => { setBindErr(e.message || String(e)); try { await sb.auth.signOut({ scope: 'local' }) } catch {} })
  }, [session, dev.state, sid, bound])

  const uid = session?.user?.id
  const live = !!uid && bound === sid && !!sid
  useEffect(() => {
    if (!live) { setReady(false); return }
    setScanErr('')
    scanSchema().then(() => setReady(true)).catch((e) => setScanErr(errText(e)))
  }, [live, uid])

  // Signed in somewhere this device isn't allowed: sign out of this browser.
  useEffect(() => {
    if (session && (dev.state === 'none' || dev.state === 'off')) sb.auth.signOut({ scope: 'local' }).catch(() => {})
  }, [session, dev.state])

  const enroll = route[0] === 'enroll' && route[1]
  let body: React.ReactNode
  if (enroll) body = <EnrollScreen token={route[1]} onDone={async () => { try { await sb.auth.signOut({ scope: 'local' }) } catch {}; go(''); checkDevice() }} />
  else if (dev.state === 'checking' || session === undefined) body = <div className="splash"><Mark /><span>Loading {APP_NAME}…</span></div>
  else if (dev.state === 'none') body = <Landing />
  else if (dev.state === 'off') body = <Landing notice="Access on this device was turned off by the owner." />
  else if (dev.state === 'offline') body = (
    <div className="login"><div className="login-card"><Brand big />
      <h2 className="pending-h">Can't reach the database</h2>
      <p>{APP_NAME} will keep retrying on its own.</p>
      <button className="btn primary full big" onClick={checkDevice}>Try again now</button>
    </div></div>
  )
  else if (recovery && session) body = <NewPassword done={() => { setRecovery(false); toast('Password updated') }} />
  else if (!session) body = <Login email={dev.email || ''} name={dev.name} error={bindErr} />
  else if (!live) body = <div className="splash"><Mark /><span>Checking this device…</span></div>
  else if (scanErr) body = <div className="login"><div className="login-card"><Brand big /><div className="alert err">Could not reach the database: {scanErr}</div><button className="btn full" onClick={() => location.reload()}>Try again</button><button className="btn ghost full" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>
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
        <Brand big />
        <div className="alert err">Could not load the connection library. Check your internet connection and reload.</div>
        <button className="btn full" onClick={() => location.reload()}>Reload</button>
      </div></div>,
    )
    return
  }
  initClient()
  // On an iPhone, a setup link must be finished from the home screen icon (it keeps its own storage).
  // Without the manifest, Add to Home Screen saves this exact link, so the icon opens it.
  if (/^#\/enroll\//.test(location.hash) && isIOS() && !isStandalone()) document.querySelector('link[rel="manifest"]')?.remove()
  root.render(pub ? <PublicInvoice token={pub[1]} /> : <App />)
}

boot()
