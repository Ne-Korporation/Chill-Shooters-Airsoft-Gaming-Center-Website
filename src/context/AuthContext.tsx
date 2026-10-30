import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { apiPost } from '../utils/apiClient'
import { clearStoredSession, getTokenExpiry, readStoredSessionRaw, writeStoredSession } from '../utils/authStorage'

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

// Sessions without "Remember me" are logged out after this much inactivity.
const IDLE_TIMEOUT_MS = Math.max(1, Number(import.meta.env.VITE_SESSION_IDLE_MINUTES) || 30) * 60 * 1000
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const

function loadSession(): AuthSession | null {
  try {
    const raw = readStoredSessionRaw()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.user || !parsed?.token) return null
    const exp = getTokenExpiry(parsed.token)
    if (exp && exp < Date.now()) {
      clearStoredSession()
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

  const startSession = React.useCallback((next: AuthSession) => {
    setSession(next)
    writeStoredSession(next, !!next.remember)
  }, [])

  const logout = React.useCallback(() => {
    setSession(null)
    clearStoredSession()
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

  // Auto-logout after inactivity for sessions that were not remembered.
  useEffect(() => {
    if (!token || session?.remember) return
    let timer = 0
    let lastReset = 0
    const reset = () => {
      const now = Date.now()
      if (now - lastReset < 1000) return
      lastReset = now
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        logout()
        toast.error('You were logged out due to inactivity.')
      }, IDLE_TIMEOUT_MS)
    }
    reset()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset))
    }
  }, [token, session?.remember, logout])

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
