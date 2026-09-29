import React from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'

type FormValues = { email: string }

export function ForgotPasswordPage() {
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: '' } })

  async function onSubmit(values: FormValues) {
    toast.success('Reset code sent. Verify OTP to continue.')
    navigate(`/otp?email=${encodeURIComponent(values.email)}&flow=reset`)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute left-[-120px] top-1/4 h-[260px] w-[260px] rounded-full bg-accent/15 blur-3xl animate-gradientShift" />

      <div className="mx-auto max-w-[860px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-2 lg:gap-6"
        >
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="uppercase tracking-[0.18em]">Recovery</span>
            </div>
            <h1 className="text-3xl font-bold leading-tight lg:text-4xl">Password Reset Protocol</h1>
            <p className="text-muted">Submit your email to receive an OTP verification code for reset.</p>

            {/* <Card className="p-4">
              <div className="text-sm font-semibold">Security note</div>
              <div className="mt-2 text-xs text-muted">This demo simulates sending OTP and routes you to verification.</div>
            </Card> */}
          </div>

          <Card className="p-4 md:p-6">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted">Forgot Password</div>
                <h2 className="text-xl font-bold">Request OTP</h2>
              </div>

              <Input
                label="Account email"
                placeholder="operator@email.com"
                error={errors.email?.message}
                {...register('email', { required: 'Email is required' })}
              />

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Sending...' : 'Send verification code'}
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

