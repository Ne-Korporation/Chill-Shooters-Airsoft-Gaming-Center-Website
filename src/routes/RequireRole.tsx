import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function RequireRole({
  children,
  roles,
}: {
  children: React.ReactElement
  roles: Array<'user' | 'admin' | 'marshal' | 'registrar'>
}) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user || !roles.includes(user.role)) {
    return <Navigate to={location.pathname.startsWith('/app') ? '/app' : '/'} replace />
  }

  return children
}

