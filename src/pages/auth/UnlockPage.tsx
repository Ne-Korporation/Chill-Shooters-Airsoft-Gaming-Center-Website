import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'

// Opened from the "many sign-in attempts" email: signs the owner straight in with the one-time
// link and clears the pause on password sign-in.
export function UnlockPage() {
  const navigate = useNavigate()
  const { loginWithUnlockLink } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // The link works once: don't send it twice (React runs effects twice in development).
    if (started.current) return
    started.current = true
    const token = new URLSearchParams(window.location.search).get('token') || ''
    if (!token) {
      setError('This link is missing its code. Open it again from the email.')
      return
    }
    loginWithUnlockLink(token)
      .then((user) => {
        toast.success('Signed in. Change your password if those attempts weren\'t you.')
        navigate(String(user.role || '').toLowerCase() === 'admin' ? '/app/admin' : '/app', { replace: true })
      })
      .catch((err: any) => setError(err?.message || 'This sign-in link did not work.'))
  }, [loginWithUnlockLink, navigate])

  return (
    <div className="relative grid min-h-screen place-items-center bg-background px-3 py-10">
      <div className="pointer-events-none absolute inset-0 bg-camouflage opacity-20" />
      <Card className="relative z-10 w-full max-w-md p-6 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold">Couldn't sign you in</h1>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <div className="mt-4 flex justify-center gap-4 text-sm font-semibold">
              <Link to="/login" className="text-accent hover:underline">Log in</Link>
              <Link to="/forgot-password" className="text-accent hover:underline">Forgot password</Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Signing you in…</h1>
            <p className="mt-2 text-sm text-muted">One moment.</p>
          </>
        )}
      </Card>
    </div>
  )
}
