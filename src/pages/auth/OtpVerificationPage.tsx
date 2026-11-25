import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { apiPost } from '../../utils/apiClient'
import { FieldError } from '../../components/ui/FieldError'

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

  const { email, flow } = useMemo(() => readQuery(), [])
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  // Password reset: 3 resends, a minute apart, then a 10-minute wait (the server enforces it; this
  // shows it). Starts from what the Forgot password page was told.
  const sentState = (location.state || {}) as { resendsLeft?: number; retryAt?: number }
  const [resendsLeft, setResendsLeft] = useState<number | null>(typeof sentState.resendsLeft === 'number' ? sentState.resendsLeft : null)
  const [retryAt, setRetryAt] = useState<number>(Number(sentState.retryAt) || 0)
  const [resendError, setResendError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (flow !== 'reset' || retryAt <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [flow, retryAt])
  const waitSeconds = flow === 'reset' ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0
  // The 10-minute message clears itself once the wait is over.
  useEffect(() => { if (waitSeconds === 0) setResendError('') }, [waitSeconds])
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { otp: '' } })

  async function onSubmit(values: FormValues) {
    if (!email) {
      toast.error('Missing email address.')
      return
    }

    setBusy(true)
    try {
      // Password reset: the right code earns a short-lived reset pass, which the new-password page
      // must send with the new password. It travels in navigation state, not the address bar.
      if (flow === 'reset') {
        const res = await apiPost<{ message?: string; resetToken: string }>('/api/auth/verify-reset-code', { email, otp: values.otp.trim() })
        toast.success(res?.message || 'Code accepted.')
        navigate(`/reset-password?email=${encodeURIComponent(email)}`, { state: { resetToken: res.resetToken } })
        return
      }
      const res = await apiPost<{ message?: string }>('/api/auth/verify-otp', { email, otp: values.otp.trim() })
      toast.success(res?.message || 'Email verified.')
      // A brand-new account is greeted as new on the login page, with the email filled in.
      if (flow === 'register') navigate('/login', { state: { newAccount: true, email } })
      else navigate('/login')
    } catch (err: any) {
      toast.error(err?.message || "That code didn't work. Check it and try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    if (!email) {
      toast.error('Missing email address.')
      return
    }

    setResending(true)
    setResendError('')
    try {
      const res = await apiPost<{ message?: string; resendsLeft?: number; retryAfterSeconds?: number }>(flow === 'reset' ? '/api/auth/forgot-password' : '/api/auth/send-otp', { email })
      toast.success(res?.message || 'Verification code resent.')
      if (flow === 'reset') {
        if (typeof res?.resendsLeft === 'number') setResendsLeft(res.resendsLeft)
        if (res?.retryAfterSeconds) { setRetryAt(Date.now() + res.retryAfterSeconds * 1000); setNow(Date.now()) }
      }
    } catch (err: any) {
      // Too soon, or the 3 resends are used: show the wait under the button and count it down.
      if (flow === 'reset' && err?.status === 429) {
        if (typeof err.body?.resendsLeft === 'number') setResendsLeft(err.body.resendsLeft)
        if (err.body?.retryAfterSeconds) { setRetryAt(Date.now() + err.body.retryAfterSeconds * 1000); setNow(Date.now()) }
        if (err.body?.limitReached) setResendError(err.message)
      } else {
        toast.error(err?.message || 'Unable to resend code')
      }
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="pointer-events-none absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute right-[-140px] top-[-140px] h-[320px] w-[320px] rounded-full bg-secondary/20 blur-3xl animate-gradientShift" />

      <div className="relative z-10 mx-auto max-w-[920px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
        >
          <div className="space-y-3">
            <div className="text-sm font-medium text-accent">Email verification</div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Check your email</h1>
            <p className="text-muted">
              Enter the one-time code sent to <span className="text-text font-semibold">{email || 'your email'}</span>.
            </p>
            {/* The server answers the same whether or not the email has an account, so say what happens either way. */}
            {flow === 'register' ? (
              <p className="text-sm text-muted">
                If this email already has an account, we emailed you how to sign in instead of a code.
              </p>
            ) : flow === 'reset' ? (
              <p className="text-sm text-muted">
                No email after a few minutes? Check spam, and make sure it's the email on your account.
              </p>
            ) : null}

            {/* <Card className="p-4">
              <div className="text-sm font-semibold">Verification code</div>
              <div className="mt-2 text-xs text-muted">A 6-digit code will be sent to your inbox via Resend.</div>
            </Card> */}
          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">Enter Code</div>
                <h2 className="text-xl font-bold">Verification code</h2>
              </div>

              <Input
                label="One-time code"
                placeholder="e.g., 123456"
                error={errors.otp?.message}
                {...register('otp', { required: 'Enter the code from your email' })}
              />

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Verifying…' : 'Verify code'}
              </Button>

              <div className="text-xs text-muted pt-2">
                Didn’t receive it?{' '}
                <button
                  type="button"
                  className="-my-2 py-2 text-accent hover:text-text transition disabled:cursor-not-allowed disabled:text-muted"
                  onClick={handleResend}
                  disabled={resending || waitSeconds > 0}
                >
                  {resending
                    ? 'Sending…'
                    : waitSeconds > 0
                      ? `Resend code in ${clock(waitSeconds)}`
                      : `Resend code${flow === 'reset' && resendsLeft !== null && resendsLeft > 0 ? ` (${resendsLeft} left)` : ''}`}
                </button>
              </div>
              {flow === 'reset' ? (
                resendError ? (
                  <FieldError className="-mt-2">{resendError.replace(/You can ask again in \d+ minutes?\./, 'You can ask again when the timer runs out.')}</FieldError>
                ) : resendsLeft === 0 && waitSeconds > 0 ? (
                  <FieldError className="-mt-2">That was the last resend. You can ask for a new code when the timer runs out.</FieldError>
                ) : null
              ) : null}
            </form>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

