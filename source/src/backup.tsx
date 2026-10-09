import { APP_NAME } from './brand'
import React, { useState } from 'react'
import { fetchAll, schema, SPEC } from './db'
import { useStore } from './store'
import { KV } from './ui'
import { fmtDateTime } from './model'

declare const __BUILD__: string
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'

// ---------- Recent errors, kept in memory for problem reports ----------
const recentErrors: { at: string; msg: string }[] = []
export function logError(msg: string) {
  recentErrors.unshift({ at: new Date().toLocaleString(), msg: String(msg).slice(0, 400) })
  recentErrors.length = Math.min(recentErrors.length, 15)
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => logError(e.message || 'Script error'))
  window.addEventListener('unhandledrejection', (e: any) => logError(e?.reason?.message || String(e?.reason)))
}

// ---------- Backup to a spreadsheet the owner keeps ----------
const BACKUP_KEY = 'lockdesk.lastBackup'
export function lastBackup(): Date | null {
  try { const v = localStorage.getItem(BACKUP_KEY); return v ? new Date(v) : null } catch { return null }
}

function loadSheetJs(): Promise<any> {
  if ((window as any).XLSX) return Promise.resolve((window as any).XLSX)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = () => resolve((window as any).XLSX)
    s.onerror = () => reject(new Error('Could not load the spreadsheet tool. Check your connection and try again.'))
    document.head.appendChild(s)
  })
}

const TABLES: [string, string][] = [
  ['customers', 'Customers'], ['jobs', 'Jobs'], ['invoices', 'Invoices'], ['payments', 'Payments'],
  ['job_parts', 'Parts'], ['job_events', 'Job timeline'], ['notifications', 'Texts'], ['profiles', 'Team'],
]

export async function downloadBackup(): Promise<{ file: string; counts: Record<string, number> }> {
  const XLSX = await loadSheetJs()
  const wb = XLSX.utils.book_new()
  const counts: Record<string, number> = {}
  for (const [table, label] of TABLES) {
    if (schema.tables[table] !== true) continue
    let rows: any[] = []
    try { rows = await fetchAll(table, { order: 'created_at' }) } catch { try { rows = await fetchAll(table) } catch { rows = [] } }
    counts[label] = rows.length
    const flat = rows.map((r) => {
      const o: any = {}
      for (const [k, v] of Object.entries(r)) o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      return o
    })
    const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{ note: 'No rows' }])
    XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31))
  }
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const file = `${APP_NAME} backup ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`
  XLSX.writeFile(wb, file)
  try { localStorage.setItem(BACKUP_KEY, d.toISOString()) } catch {}
  return { file, counts }
}

export function BackupPanel() {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(lastBackup())
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  return (
    <div className="panel">
      <h3>Backup</h3>
      <p className="small">Downloads every customer, job, invoice, payment and part into one Excel file. Save it to your email, Google Drive or iCloud. Do this weekly.</p>
      <KV k="Last backup on this device" v={last ? fmtDateTime(last) : 'Never'} />
      {counts ? <p className="small muted">{Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p> : null}
      <button className="btn primary full" disabled={busy} onClick={async () => {
        setBusy(true)
        try { const r = await downloadBackup(); setCounts(r.counts); setLast(lastBackup()); toast('Backup downloaded') }
        catch (e: any) { logError(e.message); toast(e.message, 'err') } finally { setBusy(false) }
      }}>{busy ? 'Preparing…' : 'Download backup'}</button>
    </div>
  )
}

export function BackupReminder() {
  const { me } = useStore()
  const last = lastBackup()
  if (me?.role !== 'owner') return null
  if (last && Date.now() - last.getTime() < 7 * 864e5) return null
  return (
    <a className="reminder" href="#/system">
      <strong>{last ? 'Time for your weekly backup' : 'Make your first backup'}</strong>
      <span>Download a copy of all your data. It takes a few seconds.</span>
    </a>
  )
}

export function ProblemReport() {
  const { me, email, live, error, jobs, customers } = useStore()
  const [copied, setCopied] = useState(false)
  const report = [
    `${APP_NAME} problem report`,
    `Time: ${new Date().toLocaleString()}`,
    `App version: ${BUILD}`,
    `Address: ${location.origin + location.pathname}`,
    `Signed in: ${email} (${me?.role || 'no profile'}${me && !me.approved ? ', pending' : ''})`,
    `Device: ${navigator.userAgent}`,
    `Live updates: ${live ? 'connected' : 'not connected'}`,
    `Loaded: ${jobs.length} jobs, ${customers.length} customers`,
    `Load error: ${error || 'none'}`,
    `Tables: ${Object.keys(SPEC).map((t) => `${t}=${schema.tables[t] === true ? 'ok' : schema.tables[t] === false ? 'missing' : 'no access'}`).join(', ')}`,
    'Recent errors:',
    ...(recentErrors.length ? recentErrors.map((e) => `  ${e.at}  ${e.msg}`) : ['  none']),
    '',
    'What happened (describe it here):',
  ].join('\n')
  return (
    <div className="panel">
      <h3>Something not working?</h3>
      <p className="small">Tap below, then paste it into your chat with Claude along with what happened. It includes everything needed to find the problem, and no customer details.</p>
      <button className="btn full" onClick={async () => {
        try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {
          const el = document.getElementById('problem-report') as HTMLTextAreaElement | null; el?.focus(); el?.select()
        }
      }}>{copied ? 'Copied' : 'Copy problem report'}</button>
      <textarea id="problem-report" className="mono sql" readOnly rows={4} value={report} onFocus={(e) => e.target.select()} />
    </div>
  )
}
