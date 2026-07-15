import React from 'react'
import { motion } from 'framer-motion'

type Props = {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: () => void
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  disabled,
  onClick,
}: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40'

  const sizes: Record<string, string> = {
    sm: 'h-10 px-3 text-sm',
    md: 'h-12 px-4 text-sm',
    lg: 'h-14 px-5 text-base',
  }

  const variants: Record<string, string> = {
    primary:
      'bg-primary text-background shadow-soft hover:brightness-110 active:brightness-95',
    secondary:
      'bg-secondary text-background shadow-soft hover:brightness-110 active:brightness-95',
    ghost:
      'bg-white/5 text-text border border-white/10 hover:bg-white/8 active:bg-white/10',
    danger: 'bg-danger text-background shadow-soft hover:brightness-110 active:brightness-95',
  }

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      className={[base, sizes[size], variants[variant], disabled ? 'opacity-50 cursor-not-allowed' : '', className].join(' ')}
    >
      {children}
    </motion.button>
  )
}

