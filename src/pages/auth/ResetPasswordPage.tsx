import React, { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'

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

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { password: '', confirmPassword: '' } })

  const password = watch('password')

  async function onSubmit(values: FormValues) {
    setBusy(true)
    try {
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
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="uppercase tracking-[0.18em]">Reset Password</span>
            </div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Secure Credential Update</h1>
            <p className="text-muted">
              Updating password for <span className="text-text font-semibold">{email || 'account'}</span>.
            </p>

            <Card className="p-4">
              <div className="text-sm font-semibold">Password requirements</div>
              <ul className="mt-2 space-y-2 text-xs text-muted">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-success" />
                  Minimum 4 characters
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-success" />
                  Must match confirmation
                </li>
              </ul>
            </Card>
          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">Set New Password</div>
                <h2 className="text-xl font-bold">Password</h2>
              </div>

              <Input
                label="New password"
                type="password"
                placeholder="Enter new password"
                error={errors.password?.message}
                {...register('password', { required: 'Password is required', minLength: 4 })}
              />

              <Input
                label="Confirm password"
                type="password"
                placeholder="Re-enter password"
                error={
                  errors.confirmPassword?.message ||
                  (watch('confirmPassword') && password !== watch('confirmPassword') ? 'Passwords do not match.' : undefined)
                }
                {...register('confirmPassword', { required: 'Confirmation is required' })}
              />

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

