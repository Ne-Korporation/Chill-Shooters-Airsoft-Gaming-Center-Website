import React, { useEffect, useState, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { FiCheck, FiEye, FiEyeOff } from 'react-icons/fi'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { uid } from '../../utils/id'
import { apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { completeGoogleRedirect, signInWithGoogle, type GoogleProfile } from '../../utils/firebase'
import { ExistingAccountDialog } from '../../components/auth/ExistingAccountDialog'

type FormValues = {
  name: string
  email: string
  password: string
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [pendingGoogle, setPendingGoogle] = useState<{ profile: GoogleProfile; account: { name: string; email: string } } | null>(null)
  const [confirmingGoogle, setConfirmingGoogle] = useState(false)
  const { registerWithGoogle } = useAuth()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { name: '', email: '', password: '' } })

  const password = watch('password')

  const passwordChecks = useMemo(() => ({
    hasMinLength: password ? password.length >= 8 : false,
    hasUppercase: password ? /[A-Z]/.test(password) : false,
    hasLowercase: password ? /[a-z]/.test(password) : false,
    hasSpecial: password ? /[!@#$%^&*(),.?":{}|<>_\-\\[\]`~;'\/]/.test(password) : false,
  }), [password])

  const allRequirementsMet = useMemo(() =>
    passwordChecks.hasMinLength &&
    passwordChecks.hasUppercase &&
    passwordChecks.hasLowercase &&
    passwordChecks.hasSpecial,
  [passwordChecks])

  async function onSubmit(values: FormValues) {
    if (!allRequirementsMet) {
      toast.error('Please meet all password requirements.')
      return
    }

    const payload = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      password: values.password,
    }

    try {
      await apiPost('/api/auth/register', payload)
      toast.success('Verification code sent to your email.')
      navigate(`/otp?email=${encodeURIComponent(payload.email)}&flow=register&t=${uid('otp')}`)
    } catch (err: any) {
      toast.error(err?.message || 'Registration failed')
    }
  }

  const getRedirectRoute = (role?: string) => {
    if (String(role || '').trim().toLowerCase() === 'admin') return '/app/admin'
    if (String(role || '').trim().toLowerCase() === 'registrar') return '/app'
    if (String(role || '').trim().toLowerCase() === 'marshal') return '/app'
    return '/app'
  }

  async function finishGoogleRegister(profile: GoogleProfile, confirmExisting: boolean) {
    const result = await registerWithGoogle({ name: profile.name || 'Google User', email: profile.email, idToken: profile.idToken, confirmExisting })
    if (result.needsConfirm) {
      setPendingGoogle({ profile, account: result.account })
      return
    }
    setPendingGoogle(null)
    toast.success(confirmExisting ? 'Signed in with Google.' : 'Account created with Google.')
    navigate(getRedirectRoute(result.user.role))
  }

  async function handleGoogleRegister() {
    try {
      const profile = await signInWithGoogle()
      // null: the pop-up was blocked and the browser is going to Google; we finish on return.
      if (!profile) return
      if (!profile.email) {
        throw new Error('Google did not return an email address.')
      }
      await finishGoogleRegister(profile, false)
    } catch (err: any) {
      console.error('Google registration error', err)
      toast.error(err?.message || 'Google registration failed.')
    }
  }

  // Finishes a Google sign-up that fell back to a full-page redirect.
  useEffect(() => {
    completeGoogleRedirect()
      .then((profile) => (profile?.email ? finishGoogleRegister(profile, false) : undefined))
      .catch((err: any) => toast.error(err?.message || 'Google registration failed.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function proceedWithExistingAccount() {
    if (!pendingGoogle) return
    setConfirmingGoogle(true)
    try {
      await finishGoogleRegister(pendingGoogle.profile, true)
    } catch (err: any) {
      setPendingGoogle(null)
      toast.error(err?.message || 'Google sign-in failed.')
    } finally {
      setConfirmingGoogle(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <ExistingAccountDialog
        account={pendingGoogle?.account ?? null}
        busy={confirmingGoogle}
        onProceed={proceedWithExistingAccount}
        onCancel={() => setPendingGoogle(null)}
      />
      <div className="pointer-events-none absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute right-[-120px] top-[-120px] h-[260px] w-[260px] rounded-full bg-secondary/20 blur-3xl animate-gradientShift" />

      <div className="relative z-10 mx-auto max-w-[920px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
        >
          <div className="space-y-3">
            <div className="text-sm font-medium text-accent">Registration</div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Create your operator profile</h1>
            <p className="text-muted">
              Secure onboarding for managing chill shooter reservations, payments, and waivers.
            </p>

            <Card className="p-4">
              <div className="text-sm font-semibold">What you’ll unlock</div>
              <ul className="mt-3 space-y-2 text-xs text-muted">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-success" />
                  Reservation calendar + slot prevention
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  Player profile + history tracking
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-success" />
                  Digital waiver + payment receipts
                </li>
              </ul>
            </Card>
          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">New Account</div>
                <h2 className="text-xl font-bold">Register</h2>
              </div>

              <Input
                label="Full name"
                placeholder="e.g., John Marlowe"
                error={errors.name?.message}
                {...register('name', { required: 'Name is required' })}
              />
              <Input
                label="Email"
                placeholder="operator@email.com"
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
                    placeholder="Create a strong password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-sm text-text placeholder-muted outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/25"
                    {...register('password', {
                      required: 'Password is required',
                      minLength: { value: 8, message: 'At least 8 characters' },
                      validate: {
                        hasUppercase: (v) => /[A-Z]/.test(v) || 'Need 1 uppercase',
                        hasLowercase: (v) => /[a-z]/.test(v) || 'Need 1 lowercase',
                        hasSpecial: (v) => /[!@#$%^&*(),.?":{}|<>_\-\\[\]`~;'\/]/.test(v) || 'Need 1 special symbol',
                      },
                    })}
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

                {/* Password requirement checkboxes */}
                <div className="mt-3 space-y-2">
                  {[
                    { label: '8+ characters', met: passwordChecks.hasMinLength },
                    { label: '1 uppercase letter', met: passwordChecks.hasUppercase },
                    { label: '1 lowercase letter', met: passwordChecks.hasLowercase },
                    { label: '1 special symbol', met: passwordChecks.hasSpecial },
                  ].map((req) => (
                    <div key={req.label} className="flex items-center gap-2 text-xs">
                      <span
                        className={`grid h-5 w-5 place-items-center rounded-full border-2 transition ${
                          req.met
                            ? 'border-success bg-success/20 text-success'
                            : 'border-white/20 text-muted'
                        }`}
                      >
                        {req.met && <FiCheck size={12} />}
                      </span>
                      <span className={req.met ? 'text-success' : 'text-muted'}>{req.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Creating...' : 'Create account'}
              </Button>

              <Button type="button" onClick={handleGoogleRegister} className="w-full">
                Sign up with Google
              </Button>

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  className="text-muted hover:text-text transition"
                  onClick={() => navigate('/login')}
                >
                  Back to login
                </button>
                <button
                  type="button"
                  className="text-muted hover:text-text transition"
                  onClick={() => navigate('/forgot-password')}
                >
                  Need reset?
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

