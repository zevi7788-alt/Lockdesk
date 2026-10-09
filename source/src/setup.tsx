import React, { useState } from 'react'
import { SETUP_SQL } from './setupSql'

// Copyable one time database update (parts ordering + account approval)
export function SetupScript({ intro, compact }: { intro?: React.ReactNode; compact?: boolean }) {
  const [shown, setShown] = useState(!compact)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_SQL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      const el = document.getElementById('setup-sql') as HTMLTextAreaElement | null
      el?.focus(); el?.select()
    }
  }
  return (
    <div className="setup">
      {intro ? <p className="small">{intro}</p> : null}
      {shown ? (
        <>
          <ol className="small steps">
            <li>Tap <strong>Copy update script</strong>.</li>
            <li>In Supabase, open <strong>SQL Editor</strong>, tap <strong>New</strong>, paste it, and tap <strong>Run</strong>.</li>
            <li>Come back here, open <strong>System check</strong>, and tap <strong>Rescan database</strong>.</li>
          </ol>
          <button className="btn primary full" onClick={copy}>{copied ? 'Copied' : 'Copy update script'}</button>
          <textarea id="setup-sql" className="mono sql" readOnly rows={5} value={SETUP_SQL} onFocus={(e) => e.target.select()} />
        </>
      ) : <button className="btn full" onClick={() => setShown(true)}>Show setup steps</button>}
    </div>
  )
}
