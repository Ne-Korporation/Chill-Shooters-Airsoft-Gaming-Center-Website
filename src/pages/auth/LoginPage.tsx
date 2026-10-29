import React, { useMemo, useState } from 'react'

import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { useTheme } from '../../context/ThemeContext'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { signInWithGoogle } from '../../utils/firebase'

type FormValues = {
  email: string
  password: string
  remember: boolean
}

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Set by RequireAuth and the landing page booking bar so login returns the user where they were headed.
  const redirectState = location.state as { from?: string; fromUserId?: string } | null
  const redirectFrom = redirectState?.from
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: '', password: '', remember: false } })

  const { theme } = useTheme()

  const missionCopy = useMemo(
    () => ({
      title: 'Welcome back',
      subtitle: 'Log in to book games, sign your waiver, and track your payments.',
      hint: 'Demo roles are inferred by email suffix:',
      suffixes: [
        { k: '@admin.local', v: 'admin' },
        { k: '@marshal.local', v: 'marshal' },
        { k: '@registrar.local', v: 'registrar' },
      ],
    }),
    [],
  )

  // Return to the page the session ended on only for the same account (a page left by another
  // user, e.g. their profile, is not yours), and never into the admin area for non-admins.
  const getRedirectRoute = (role?: string, userId?: string) => {
    const isAdmin = String(role || '').trim().toLowerCase() === 'admin'
    const sameAccount = !redirectState?.fromUserId || redirectState.fromUserId === String(userId || '')
    const allowedForRole = isAdmin || !redirectFrom?.startsWith('/app/admin')
    if (redirectFrom?.startsWith('/app') && sameAccount && allowedForRole) return redirectFrom
    return isAdmin ? '/app/admin' : '/app'
  }

  async function onSubmit(values: FormValues) {
    try {
      const user = await login(values)
      toast.success('Authentication accepted.')
      navigate(getRedirectRoute(user.role, user.id))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to sign in. Please try again.')
    }
  }

  async function handleGoogleSignIn() {
    try {
      const profile = await signInWithGoogle()
      const user = await loginWithGoogle({ name: profile.name, email: profile.email, idToken: profile.idToken, remember: getValues('remember') })
      toast.success('Signed in with Google.')
      navigate(getRedirectRoute(user.role, user.id))
    } catch (err: any) {
      console.error('Google sign-in error', err)
      toast.error(err?.message || 'Google sign-in failed.')
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="pointer-events-none absolute inset-0 bg-camouflage opacity-20" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[260px] w-[260px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl animate-gradientShift" />
  
  
      <div className="relative z-10 mx-auto max-w-[980px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
>
          <div className="space-y-4">
            <div className="text-sm font-medium text-accent">Aim. Book. Play.</div>
            <h1 className={`text-3xl font-bold leading-tight lg:text-4xl ${theme === 'light' ? 'text-black' : ''}`}>{missionCopy.title}</h1>
            <p className="text-muted">{missionCopy.subtitle}</p>

            {/* <Card className="p-4">
              <div className="text-sm font-semibold">Demo Access Roles</div>
              <div className="mt-2 text-xs text-muted">{missionCopy.hint}</div>
              <div className="mt-3 space-y-2">
                {missionCopy.suffixes.map((s) => (
                  <div
                    key={s.k}
                    className="flex items-center justify-between rounded-xl bg-white/5 border border-white/5 px-3 py-2"
                  >
                    <div className="font-mono text-[11px] text-muted">{s.k}</div>
                    <div className="text-sm font-semibold">{s.v}</div>
                  </div>
                ))}
              </div>
            </Card> */}
          </div>

          <Card className="p-4 md:p-6">
            <div className="mb-3">
              <Link to="/">
                <Button variant="ghost" size="sm">Back</Button>
              </Link>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-sm font-medium text-accent">Chill Shooters</div>
                <h2 className="text-xl font-bold">Log in to your account</h2>
              </div>

              <Input
                label="Email"
                placeholder="you@example.com"
                error={errors.email?.message}
                {...register('email', { required: 'Email is required' })}
              />
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-sm text-text placeholder-muted outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/25"
                    {...register('password', { required: 'Password is required', minLength: 4 })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition"
                    tabIndex={-1}
                  >
                    {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                  </button>
                </div>
                {errors.password?.message && (
                  <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" {...register('remember')} />
                Remember me (stay logged in)
              </label>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Verifying...' : 'Sign In'}
              </Button>

              <div className="pt-3">
                <Button type="button" variant="ghost" onClick={handleGoogleSignIn} className="w-full">
                  Continue with Google
                </Button>
              </div>

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  className="text-muted hover:text-text transition"
                  onClick={() => navigate('/forgot-password')}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  className="text-muted hover:text-text transition"
                  onClick={() => navigate('/register')}
                >
                  Create account
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
