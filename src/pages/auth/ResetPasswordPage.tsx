import React, { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { FiCheck, FiEye, FiEyeOff } from 'react-icons/fi'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { apiPost } from '../../utils/apiClient'

type FormValues = {
  password: string
  confirmPassword: string
}

function readEmail() {
  const sp = new URLSearchParams(window.location.search)
  return sp.get('email') ?? ''
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const email = useMemo(() => readEmail(), [])
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { password: '', confirmPassword: '' } })

  const password = watch('password')

  const passwordChecks = useMemo(() => ({
    hasMinLength: password ? password.length >= 8 : false,
    hasUppercase: password ? /[A-Z]/.test(password) : false,
    hasLowercase: password ? /[a-z]/.test(password) : false,
    hasSpecial: password ? /[!@#$%^&*(),.?":{}|<>_\-\[\]`~;'\/]/.test(password) : false,
  }), [password])

  const allRequirementsMet = useMemo(
    () =>
      passwordChecks.hasMinLength &&
      passwordChecks.hasUppercase &&
      passwordChecks.hasLowercase &&
      passwordChecks.hasSpecial,
    [passwordChecks],
  )

  async function onSubmit(values: FormValues) {
    setBusy(true)
    try {
      if (!allRequirementsMet) {
        toast.error('Please meet all password requirements.')
        return
      }
      if (values.password !== values.confirmPassword) {
        toast.error('Passwords do not match.')
        return
      }
      if (!email) {
        toast.error('Missing email address.')
        return
      }

      const res = await apiPost<{ message?: string }>('/api/auth/reset-password', {
        email,
        password: values.password,
      })
      toast.success(res?.message || 'Password updated successfully.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute left-[-140px] top-[-160px] h-[340px] w-[340px] rounded-full bg-accent/15 blur-3xl animate-gradientShift" />

      <div className="mx-auto max-w-[940px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
        >
          <div className="space-y-3">
            <div className="text-sm font-medium text-accent">Reset Password</div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Secure Credential Update</h1>
            <p className="text-muted">
              Updating password for <span className="text-text font-semibold">{email || 'account'}</span>.
            </p>

          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">Set New Password</div>
                <h2 className="text-xl font-bold">Password</h2>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter new password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-sm text-text placeholder-muted outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/25"
                    {...register('password', {
                      required: 'Password is required',
                      minLength: { value: 8, message: 'At least 8 characters' },
                      validate: {
                        hasUppercase: (v) => /[A-Z]/.test(v) || 'Need 1 uppercase',
                        hasLowercase: (v) => /[a-z]/.test(v) || 'Need 1 lowercase',
                        hasSpecial: (v) => /[!@#$%^&*(),.?":{}|<>_\-\[\]`~;'\/]/.test(v) || 'Need 1 special symbol',
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
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Re-enter password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-sm text-text placeholder-muted outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/25"
                    {...register('confirmPassword', { required: 'Confirmation is required' })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition"
                    tabIndex={-1}
                  >
                    {showConfirm ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword?.message && (
                  <p className="mt-1 text-xs text-danger">{errors.confirmPassword.message}</p>
                )}
                {watch('confirmPassword') && password !== watch('confirmPassword') && (
                  <p className="mt-1 text-xs text-danger">Passwords do not match.</p>
                )}
              </div>
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
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Updating...' : 'Update Password'}
              </Button>

              <div className="pt-2 text-xs">
                <button
                  type="button"
                  className="text-muted hover:text-text transition"
                  onClick={() => navigate('/login')}
                >
                  Back to login
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

