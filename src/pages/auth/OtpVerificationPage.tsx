import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'

type FormValues = { otp: string }

function readQuery() {
  const sp = new URLSearchParams(window.location.search)
  return {
    email: sp.get('email') ?? '',
    flow: sp.get('flow') ?? 'login',
  }
}

export function OtpVerificationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  void location

  const { email, flow } = useMemo(() => readQuery(), [])
  const [busy, setBusy] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { otp: '' } })

  async function onSubmit(values: FormValues) {
    setBusy(true)
    try {
      if (values.otp.trim().length < 4) {
        toast.error('OTP must be at least 4 digits.')
        return
      }
      toast.success('OTP verified.')
      if (flow === 'reset') navigate(`/reset-password?email=${encodeURIComponent(email)}`)
      else navigate('/login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute right-[-140px] top-[-140px] h-[320px] w-[320px] rounded-full bg-secondary/20 blur-3xl animate-gradientShift" />

      <div className="mx-auto max-w-[920px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
        >
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="uppercase tracking-[0.18em]">OTP Verification</span>
            </div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Authenticate Transmission</h1>
            <p className="text-muted">
              Enter the one-time code sent to <span className="text-text font-semibold">{email || 'your email'}</span>.
            </p>

            <Card className="p-4">
              <div className="text-sm font-semibold">Demo OTP</div>
              <div className="mt-2 text-xs text-muted">Any 4+ digits will verify in this frontend prototype.</div>
            </Card>
          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">Enter Code</div>
                <h2 className="text-xl font-bold">OTP</h2>
              </div>

              <Input
                label="One-time code"
                placeholder="e.g., 1234"
                error={errors.otp?.message}
                {...register('otp', { required: 'OTP is required' })}
              />

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Verifying...' : 'Verify OTP'}
              </Button>

              <div className="text-xs text-muted pt-2">
                Didn’t receive it?{' '}
                <button
                  type="button"
                  className="text-accent hover:text-text transition"
                  onClick={() => navigate('/forgot-password')}
                >
                  Resend
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

