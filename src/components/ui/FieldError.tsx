import React from 'react'

// A form problem shown in red under the field it is about (the same look as Input's `error`),
// instead of a pop-up: the person stays on the form and sees what to fix where they fix it.
export function FieldError({ children, className = 'mt-2' }: { children?: React.ReactNode; className?: string }) {
  if (!children) return null
  return <div role="alert" className={`${className} text-xs font-semibold text-danger`}>{children}</div>
}

// Red border for a raw <input>/<select> that has a FieldError under it.
export const errorBorder = (error?: string | null | false) => (error ? ' !border-danger/50' : '')

// Per-form field errors: set one when a check fails, and a field's error clears as soon as it changes.
export function useFieldErrors<K extends string>() {
  const [errors, setErrors] = React.useState<Partial<Record<K, string>>>({})
  const fail = React.useCallback((field: K, message: string) => {
    setErrors((current) => ({ ...current, [field]: message }))
    return false as const
  }, [])
  const clear = React.useCallback((field?: K) => {
    setErrors((current) => {
      if (!field) return Object.keys(current).length ? {} : current
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])
  return { errors, fail, clear }
}
