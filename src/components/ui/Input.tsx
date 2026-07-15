import React from 'react'

type Props = {
  label?: string
  hint?: string
  error?: string
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, Props>(function Input({ label, hint, error, className = '', ...props }, ref) {
  return (
    <label className="block">
      {label ? <div className="mb-2 text-sm font-semibold text-text">{label}</div> : null}
      <input
        {...props}
        ref={ref}
        className={[
          'w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-text placeholder:text-muted shadow-glass focus:outline-none focus:ring-2 focus:ring-accent/40',
          error ? 'border-danger/50 focus:ring-danger/40' : '',
          className,
        ].join(' ')}
      />
      {hint && !error ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
      {error ? <div className="mt-2 text-xs font-semibold text-danger">{error}</div> : null}
    </label>
  )
})

Input.displayName = 'Input'

