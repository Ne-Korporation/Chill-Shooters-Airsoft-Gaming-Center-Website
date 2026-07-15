import React from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { uid } from '../../utils/id'

type FormValues = {
  name: string
  email: string
  password: string
}

export function RegisterPage() {
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { name: '', email: '', password: '' } })

  async function onSubmit(values: FormValues) {
    toast.success('Account created. Proceed to OTP verification.')
    navigate(`/otp?email=${encodeURIComponent(values.email)}&t=${uid('otp')}`)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-3 py-10 lg:py-14">
      <div className="absolute inset-0 bg-camouflage opacity-20" />
      <div className="absolute right-[-120px] top-[-120px] h-[260px] w-[260px] rounded-full bg-secondary/20 blur-3xl animate-gradientShift" />

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
              <span className="uppercase tracking-[0.18em]">Registration</span>
            </div>
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
              <Input
                label="Password"
                type="password"
                placeholder="Minimum 4 characters"
                error={errors.password?.message}
                {...register('password', { required: 'Password is required', minLength: 4 })}
              />

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Creating...' : 'Create account'}
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

