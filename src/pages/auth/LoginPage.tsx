import React, { useMemo, useState } from 'react'

import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { useNavigate, Link } from 'react-router-dom'
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
}

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: '', password: '' } })

  const { theme } = useTheme()

  const missionCopy = useMemo(
    () => ({
      title: 'Access the Operations Console',
      subtitle: 'Sign in to manage reservations, players, and inventory.',
      hint: 'Demo roles are inferred by email suffix:',
      suffixes: [
        { k: '@admin.local', v: 'admin' },
        { k: '@marshal.local', v: 'marshal' },
        { k: '@registrar.local', v: 'registrar' },
      ],
    }),
    [],
  )

  const getRedirectRoute = (role?: string) => {
    if (String(role || '').trim().toLowerCase() === 'admin') return '/app/admin'
    return '/app'
  }

  async function onSubmit(values: FormValues) {
    try {
      const user = await login(values)
      toast.success('Authentication accepted.')
      navigate(getRedirectRoute(user.role))
    } catch {
      toast.error('Authentication failed. Try again.')
    }
  }

  async function handleGoogleSignIn() {
    try {
      const profile = await signInWithGoogle()
      const user = await loginWithGoogle({ name: profile.name, email: profile.email })
      toast.success('Signed in with Google.')
      navigate(getRedirectRoute(user.role))
    } catch (err) {
      console.error('Google sign-in error', err)
      toast.error('Google sign-in failed.')
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute left-1/2 top-[-120px] h-[260px] w-[260px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl animate-gradientShift" />
  
  
      <div className="mx-auto max-w-[980px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
>
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="uppercase tracking-[0.18em]">AIM • BOOK • PLAY</span>
            </div>
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
                <div className="text-xs uppercase tracking-widest text-muted">Operator Login</div>
                <h2 className="text-xl font-bold">Enter Credentials</h2>
              </div>

              <Input
                label="Email"
                placeholder="operator@chillshooters.com"
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

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Verifying...' : 'Sign In'}
              </Button>

              <div className="pt-3">
                <Button type="button" onClick={handleGoogleSignIn} className="w-full">
                  Sign in with Google
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

