import React, { createContext, useContext, useMemo, useState } from 'react'

import { apiPost } from '../utils/apiClient'

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
}

type AuthContextValue = {
  user: AuthUser | null
  token: string
  isAuthenticated: boolean
  login: (payload: { email: string; password: string }) => Promise<AuthUser>
  loginWithGoogle: (payload: { name: string; email: string }) => Promise<AuthUser>
  registerWithGoogle: (payload: { name: string; email: string }) => Promise<AuthUser>
  register: (payload: { name: string; email: string; password: string }) => Promise<void>
  updateUser: (updates: Partial<AuthUser>) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'aim-book-play.auth'

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.user || !parsed?.token) return null
    return parsed as AuthSession
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())

  const user = session?.user ?? null
  const token = session?.token ?? ''

  const updateUser = React.useCallback((updates: Partial<AuthUser>) => {
    setSession((current) => {
      if (!current) return current
      const nextUser = { ...current.user, ...updates }
      const next = { ...current, user: nextUser }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!user,
      login: async ({ email, password }) => {
        const res = await apiPost<any>('/api/auth/login', { email, password })
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error('Login failed')
        }
        const nextSession = { user: res.user, token: res.token }
        setSession(nextSession)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
        return res.user
      },
      loginWithGoogle: async ({ name, email }) => {
        const res = await apiPost<any>('/api/auth/social-login', { name, email })
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error('Social login failed')
        }
        const nextSession = { user: res.user, token: res.token }
        setSession(nextSession)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
        return res.user
      },
      registerWithGoogle: async ({ name, email }) => {
        const res = await apiPost<any>('/api/auth/social-register', { name, email })
        if (!res?.ok || !res?.user || !res?.token) {
          throw new Error(res?.error || 'Google registration failed')
        }
        const nextSession = { user: res.user, token: res.token }
        setSession(nextSession)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
        return res.user
      },
      register: async ({ name, email, password }) => {
        const res = await apiPost<any>('/api/auth/register', { name, email, password })
        if (!res?.ok) throw new Error(res?.error || 'Registration failed')
      },
      updateUser,
      logout: () => {
        setSession(null)
        localStorage.removeItem(STORAGE_KEY)
      },
    }),
    [session, token, updateUser, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}


