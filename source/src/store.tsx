import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { sb, col, schema } from './db'
import { loadInvoices, loadCompany, saveCompany, Invoice, Company } from './invoices'
import { loadAll, loadParts, loadAccountInfo, loadRequests, Job, Customer, Profile, Payment, Part, AccountInfo, AccessRequest, toProfile } from './model'

type Store = {
  userId: string
  email: string
  me: Profile | null
  jobs: Job[]
  customers: Customer[]
  profiles: Profile[]
  payments: Payment[]
  parts: Part[]
  partsFor: (jobId: string) => Part[]
  accounts: Map<string, AccountInfo>
  requests: AccessRequest[]
  invoices: Invoice[]
  company: Company | null
  emailReady: boolean
  techs: Profile[]
  loading: boolean
  error: string
  live: boolean
  reload: () => Promise<void>
  techName: (id: string | null) => string
  toast: (msg: string, kind?: 'ok' | 'err') => void
}

const Ctx = createContext<Store>(null as any)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ userId, email, children, onToast }: { userId: string; email: string; children: React.ReactNode; onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [state, setState] = useState({ jobs: [] as Job[], customers: [] as Customer[], profiles: [] as Profile[], payments: [] as Payment[], parts: [] as Part[], accounts: new Map<string, AccountInfo>(), requests: [] as AccessRequest[], invoices: [] as Invoice[], company: null as Company | null, emailReady: false })
  const [me, setMe] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const timer = useRef<any>(null)
  const knownJobs = useRef<Set<string> | null>(null)

  const reload = useCallback(async () => {
    try {
      const [base, parts, accounts, requests, invoices, co] = await Promise.all([
        loadAll(), loadParts().catch(() => []), loadAccountInfo().catch(() => new Map()), loadRequests().catch(() => []),
        loadInvoices().catch(() => []), loadCompany().catch(() => ({ company: null, emailReady: false })),
      ])
      const data = { ...base, parts, accounts, requests, invoices, company: co.company, emailReady: co.emailReady }
      setState(data)
      let mine = data.profiles.find((p) => p.id === userId) || null
      if (!mine) {
        const idc = col('profiles', 'id') || 'id'
        const r = await sb.from('profiles').select('*').eq(idc, userId).maybeSingle()
        if (r.data) mine = toProfile(r.data)
      }
      setMe(mine)
      // Remember this site's address so invoice emails link back to it
      if (co.company && !co.company.appUrl && mine?.role === 'owner' && mine.approved) {
        saveCompany(co.company).catch(() => {})
      }
      // Alert technicians to newly assigned jobs
      const myIds = new Set(data.jobs.filter((j) => j.techId === userId).map((j) => j.id))
      if (knownJobs.current && mine?.role === 'technician') {
        const fresh = [...myIds].filter((id) => !knownJobs.current!.has(id))
        if (fresh.length) {
          onToast(fresh.length === 1 ? 'New job assigned to you' : `${fresh.length} new jobs assigned to you`)
          try { navigator.vibrate?.([200, 100, 200]) } catch {}
        }
      }
      knownJobs.current = myIds
      setError('')
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [userId])

  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(reload, 350)
  }, [reload])

  useEffect(() => {
    reload()
    const ch = sb.channel('lockdesk-live')
    for (const t of ['jobs', 'job_events', 'payments', 'customers', 'notifications', 'job_parts', 'profiles', 'access_requests', 'invoices']) {
      if (schema.tables[t] === false) continue
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, soon)
    }
    ch.subscribe((status: string) => setLive(status === 'SUBSCRIBED'))
    // Safety net: refresh every 60s and when the app comes back to the foreground
    const iv = setInterval(reload, 60000)
    const vis = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', vis)
    return () => {
      sb.removeChannel(ch)
      clearInterval(iv)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [reload, soon])

  const techs = state.profiles.filter((p) => p.role === 'technician' && p.approved)
  const techName = (id: string | null) => {
    if (!id) return 'Unassigned'
    return state.profiles.find((p) => p.id === id)?.name || 'Unknown technician'
  }

  const partsFor = (jobId: string) => state.parts.filter((p) => p.jobId === jobId)

  return (
    <Ctx.Provider value={{ userId, email, me, ...state, partsFor, techs, loading, error, live, reload, techName, toast: onToast }}>
      {children}
    </Ctx.Provider>
  )
}
