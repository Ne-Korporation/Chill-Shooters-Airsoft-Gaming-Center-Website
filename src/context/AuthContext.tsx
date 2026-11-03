import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { apiPost } from '../utils/apiClient'
import {
  AUTH_STORAGE_KEY,
  LAST_ACTIVITY_KEY,
  clearLastActivity,
  clearStoredSession,
  getTokenExpiry,
  readLastActivity,
  readStoredSessionRaw,
  writeLastActivity,
  writeStoredSession,
} from '../utils/authStorage'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type AuthUser = {
  id: string
  name: string
  email: string
  role: Role
}

type AuthSession = {
  user: AuthUser
  token: string
  remember?: boolean
}

type GoogleAuthPayload = { name: string; email: string; idToken: string; confirmExisting?: boolean }

// When the Google email already has an account, the API asks the player to confirm
// before signing in; call again with confirmExisting: true to proceed.
export type GoogleAuthResult =
  | { user: AuthUser; needsConfirm?: false }
  | { needsConfirm: true; account: { name: string; email: string } }

type AuthContextValue = {
  user: AuthUser | null
  token: string
  isAuthenticated: boolean
  login: (payload: { email: string; password: string; remember?: boolean }) => Promise<AuthUser>
  loginWithGoogle: (payload: GoogleAuthPayload & { remember?: boolean }) => Promise<GoogleAuthResult>
  registerWithGoogle: (payload: GoogleAuthPayload) => Promise<GoogleAuthResult>
  register: (payload: { name: string; email: string; password: string }) => Promise<void>
  updateUser: (updates: Partial<AuthUser>) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Every session is logged out after this much inactivity. "Remember me" sessions get a longer
// window (they still survive a browser restart), but are not kept open forever when left alone.
const IDLE_TIMEOUT_MS = Math.max(1, Number(import.meta.env.VITE_SESSION_IDLE_MINUTES) || 30) * 60 * 1000
const REMEMBERED_IDLE_TIMEOUT_MS = Math.max(1, Number(import.meta.env.VITE_REMEMBERED_SESSION_IDLE_HOURS) || 24) * 60 * 60 * 1000
// A warning with a "Stay signed in" button appears this long before the logout.
const IDLE_WARNING_MS = 60 * 1000
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const

function idleLimitFor(session: AuthSession | null) {
  return session?.remember ? REMEMBERED_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS
}

function loadSession(): AuthSession | null {
  try {
    const raw = readStoredSessionRaw()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.user || !parsed?.token) return null
    const exp = getTokenExpiry(parsed.token)
    // Expired token, or the app sat unused for longer than the idle limit since it was last open.
    const lastActivity = readLastActivity()
    if ((exp && exp < Date.now()) || (lastActivity && Date.now() - lastActivity > idleLimitFor(parsed))) {
      clearStoredSession()
      clearLastActivity()
      return null
    }
    return parsed as AuthSession
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())

  const user = session?.user ?? null
  const token = session?.token ?? ''

  const [idleWarning, setIdleWarning] = useState(false)
  const idleWarningRef = React.useRef(false)
  idleWarningRef.current = idleWarning

  const startSession = React.useCallback((next: AuthSession) => {
    writeLastActivity()
    setSession(next)
    writeStoredSession(next, !!next.remember)
  }, [])

  const logout = React.useCallback(() => {
    setSession(null)
    setIdleWarning(false)
    clearStoredSession()
    clearLastActivity()
  }, [])

  const updateUser = React.useCallback((updates: Partial<AuthUser>) => {
    setSession((current) => {
      if (!current) return current
      const nextUser = { ...current.user, ...updates }
      const next = { ...current, user: nextUser }
      writeStoredSession(next, !!next.remember)
      return next
    })
  }, [])

  // Log out when the token itself expires.
  useEffect(() => {
    if (!token) return
    const exp = getTokenExpiry(token)
    if (!exp) return
    const timer = window.setTimeout(() => {
      logout()
      toast.error('Your session has expired. Please log in again.')
    }, Math.max(0, Math.min(exp - Date.now(), 2 ** 31 - 1)))
    return () => window.clearTimeout(timer)
  }, [token, logout])

  // Auto-logout after inactivity. Activity is stamped in localStorage (shared by all tabs), and the
  // clock is checked every few seconds and whenever the tab comes back into view, so the logout
  // still happens after the computer slept or the tab sat in the background.
  useEffect(() => {
    if (!token) return
    const limit = idleLimitFor(session)
    let lastStamp = 0
    if (!readLastActivity()) writeLastActivity()

    const markActive = () => {
      const now = Date.now()
      if (now - lastStamp < 5000) return
      lastStamp = now
      writeLastActivity(now)
    }
    const check = () => {
      const idleFor = Date.now() - (readLastActivity() || Date.now())
      if (idleFor >= limit) {
        logout()
        toast.error('You were logged out because the app was left unused.')
        return
      }
      setIdleWarning(idleFor >= limit - IDLE_WARNING_MS)
    }

    check()
    const interval = window.setInterval(check, 5000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    // While the warning is up, only the "Stay signed in" button counts as activity.
    const onActivity = () => {
      if (!idleWarningRef.current) markActive()
    }
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    // Another tab logged out or was active: follow it.
    const onStorage = (event: StorageEvent) => {
      const loggedOutElsewhere = (event.key === AUTH_STORAGE_KEY && !readStoredSessionRaw()) || (event.key === LAST_ACTIVITY_KEY && event.newValue === null)
      if (loggedOutElsewhere) logout()
      else check()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearInterval(interval)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      window.removeEventListener('storage', onStorage)
    }
    // session?.remember is the only part of the session the limit depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session?.remember, logout])

  const staySignedIn = React.useCallback(() => {
    writeLastActivity()
    setIdleWarning(false)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!user,
      login: async ({ email, password, remember = false }) => {
        const res = await apiPost<any>('/api/auth/login', { email, password, remember })
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error('Login failed')
        }
        startSession({ user: res.user, token: res.token, remember })
        return res.user
      },
      loginWithGoogle: async ({ name, email, idToken, confirmExisting = false, remember = false }) => {
        const res = await apiPost<any>('/api/auth/social-login', { name, email, idToken, confirmExisting, remember })
        if (res?.ok && res?.needsConfirm) return { needsConfirm: true, account: res.account }
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error('Social login failed')
        }
        startSession({ user: res.user, token: res.token, remember })
        return { user: res.user }
      },
      registerWithGoogle: async ({ name, email, idToken, confirmExisting = false }) => {
        const res = await apiPost<any>('/api/auth/social-register', { name, email, idToken, confirmExisting })
        if (res?.ok && res?.needsConfirm) return { needsConfirm: true, account: res.account }
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error(res?.error || 'Google registration failed')
        }
        startSession({ user: res.user, token: res.token })
        return { user: res.user }
      },
      register: async ({ name, email, password }) => {
        const res = await apiPost<any>('/api/auth/register', { name, email, password })
        if (!res?.ok) throw new Error(res?.error || 'Registration failed')
      },
      updateUser,
      logout,
    }),
    [token, updateUser, user, startSession, logout],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {idleWarning && user ? (
        <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-warning-title">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-background p-5 text-text shadow-soft">
            <div id="idle-warning-title" className="text-lg font-bold">Still there?</div>
            <p className="mt-2 text-sm text-muted">You haven't used the app for a while. For your security you'll be logged out in about a minute.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={logout} className="surface hover-row h-10 rounded-xl px-4 text-sm font-semibold">Log out now</button>
              <button type="button" onClick={staySignedIn} autoFocus className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-white">Stay signed in</button>
            </div>
          </div>
        </div>
      ) : null}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
