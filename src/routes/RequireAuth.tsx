import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { readLastUserId } from '../utils/authStorage'

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    // fromUserId lets the login page send only the same account back to this page.
    return <Navigate to="/login" replace state={{ from: location.pathname, fromUserId: readLastUserId() }} />
  }

  return children
}

