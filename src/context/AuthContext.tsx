import React, { createContext, useContext, useMemo, useState } from 'react'

import { apiPost } from '../utils/apiClient'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type AuthUser = {
  id: string
  name: string
  email: string
  role: Role
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  login: (payload: { email: string; password: string }) => Promise<void>
  register: (payload: { name: string; email: string; password: string }) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'aim-book-play.auth.user'

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => loadUser())

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      login: async ({ email, password }) => {
        const res = await apiPost<any>('/api/auth/login', { email, password })
        if (!res?.ok || !res?.user) {
          throw new Error('Login failed')
        }
        setUser(res.user)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(res.user))
      },
      register: async ({ name, email, password }) => {
        const res = await apiPost<any>('/api/auth/register', { name, email, password })
        if (!res?.ok) throw new Error(res?.error || 'Registration failed')
      },
      logout: () => {
        setUser(null)
        localStorage.removeItem(STORAGE_KEY)
      },
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}


