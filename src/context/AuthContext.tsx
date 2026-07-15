import React, { createContext, useContext, useMemo, useState } from 'react'

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
      login: async ({ email }) => {
        // Fake auth: allow admin/marshal/registrar by email suffix.
        const role: Role =
          email.endsWith('@admin.local')
            ? 'admin'
            : email.endsWith('@marshal.local')
              ? 'marshal'
              : email.endsWith('@registrar.local')
                ? 'registrar'
                : 'user'

        const next: AuthUser = {
          id: 'u_' + Math.random().toString(16).slice(2),
          name: role === 'admin' ? 'Command Admin' : role === 'marshal' ? 'Marshal Lead' : role === 'registrar' ? 'Registrar Clerk' : 'Operator',
          email,
          role,
        }

        setUser(next)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      },
      register: async ({ name, email }) => {
        const next: AuthUser = {
          id: 'u_' + Math.random().toString(16).slice(2),
          name,
          email,
          role: 'user',
        }
        setUser(next)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
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

