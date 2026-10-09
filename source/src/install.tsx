import React, { useState } from 'react'

// Gentle hint to put LockDesk on the home screen, shown only in a phone browser tab
export function InstallHint() {
  const standalone = (() => {
    try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true } catch { return false }
  })()
  const phone = /iphone|ipad|ipod|android/i.test(navigator.userAgent)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('lockdesk.installHint') === 'off' } catch { return false } })
  if (standalone || !phone || hidden) return null
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const close = () => { setHidden(true); try { localStorage.setItem('lockdesk.installHint', 'off') } catch {} }
  return (
    <div className="install-hint">
      <div>
        <strong>Add LockDesk to your home screen</strong>
        <div className="small">
          {ios ? <>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</> : <>Tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> or <strong>Install app</strong>.</>}
        </div>
      </div>
      <button className="btn ghost sm" onClick={close} aria-label="Dismiss">Got it</button>
    </div>
  )
}
