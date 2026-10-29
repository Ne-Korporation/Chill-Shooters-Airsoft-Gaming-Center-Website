import React from 'react'
import { motion } from 'framer-motion'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  // Soft, tinted variants for row actions in tables and lists (approve / reject / flag).
  | 'success-soft'
  | 'danger-soft'
  | 'accent-soft'

type Props = {
  children: React.ReactNode
  variant?: ButtonVariant
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  'aria-label'?: string
}

const sizes: Record<NonNullable<Props['size']>, string> = {
  xs: 'h-8 px-3 text-xs',
  sm: 'h-10 px-3 text-sm',
  md: 'h-12 px-4 text-sm',
  lg: 'h-14 px-5 text-base',
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-soft hover:brightness-110 active:brightness-95',
  secondary: 'bg-secondary text-white shadow-soft hover:brightness-110 active:brightness-95',
  ghost: 'surface hover-row text-text',
  danger: 'bg-danger text-white shadow-soft hover:brightness-110 active:brightness-95',
  'success-soft': 'border border-success/30 bg-success/10 text-success hover:bg-success/20',
  'danger-soft': 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
  'accent-soft': 'border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  disabled,
  onClick,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const base =
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40'

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      whileHover={disabled ? undefined : { scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      className={[base, sizes[size], variants[variant], disabled ? 'opacity-50 cursor-not-allowed' : '', className].join(' ')}
    >
      {children}
    </motion.button>
  )
}

// Lays out a row of actions with even spacing. Put neutral actions (View, Edit) first,
// the main positive action next, and destructive ones (Reject, Remove) last.
export function ActionGroup({ children, align = 'end', className = '' }: { children: React.ReactNode; align?: 'start' | 'end'; className?: string }) {
  return (
    <div className={['flex flex-wrap items-center gap-2', align === 'end' ? 'justify-end' : 'justify-start', className].join(' ')}>
      {children}
    </div>
  )
}
