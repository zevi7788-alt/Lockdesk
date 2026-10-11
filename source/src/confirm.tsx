import React, { useState } from 'react'
import { Modal } from './ui'

// Two step confirmation for permanent deletes
export function DeleteConfirm({ title, lines, button, onConfirm, onClose }: {
  title: string; lines: React.ReactNode[]; button: string; onConfirm: () => Promise<void>; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <div className="danger-box">
        <p className="small"><strong>This can't be undone.</strong> It permanently removes:</p>
        <ul className="del-list">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <p className="small">Type <strong>DELETE</strong> to confirm.</p>
        <input id="del-confirm" value={typed} autoCapitalize="characters" onChange={(e) => setTyped(e.target.value)} />
      </div>
      {err ? <div className="alert err">{err}</div> : null}
      <button className="btn danger full big" disabled={busy || typed.trim().toUpperCase() !== 'DELETE'} onClick={async () => {
        setBusy(true); setErr('')
        try { await onConfirm() } catch (e: any) { setErr(e.message || String(e)); setBusy(false) }
      }}>{busy ? 'Deleting…' : button}</button>
      <button className="btn ghost full" onClick={onClose}>Cancel</button>
    </Modal>
  )
}
