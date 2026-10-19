// Generated from brand.json by build.py. Change the name there.
declare const __APP_NAME__: string
declare const __APP_TAGLINE__: string
export const APP_NAME = typeof __APP_NAME__ === 'string' ? __APP_NAME__ : 'LockDesk'
export const APP_TAGLINE = typeof __APP_TAGLINE__ === 'string' ? __APP_TAGLINE__ : 'Legend Locksmith'
declare const __WEB_URL__: string
// Public web address of the app. Used for customer invoice links, also from inside the iPhone app.
export const WEB_URL = typeof __WEB_URL__ === 'string' ? __WEB_URL__ : 'https://zevi7788-alt.github.io/Lockdesk/'
export const isNativeApp = () => { try { return !!(window as any).Capacitor?.isNativePlatform?.() } catch { return false } }
export const appBase = () => (isNativeApp() || !/^https?:/.test(location.protocol) ? WEB_URL : location.origin + location.pathname)
