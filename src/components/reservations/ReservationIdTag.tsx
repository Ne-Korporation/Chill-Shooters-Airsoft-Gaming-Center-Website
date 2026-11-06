import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiCopy } from 'react-icons/fi'

// Reservations made before short ids were "R-" + a full UUID. Show those as their first block
// ("R-1A2B3C4D"); it is still unique enough to search by, and copying keeps the full id.
export function shortReservationId(id?: string | null) {
  const value = String(id || '')
  const legacy = value.match(/^R-([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  return legacy ? `R-${legacy[1].toUpperCase()}` : value
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // Older browsers or non-secure pages: fall back to a hidden text field.
    const field = document.createElement('textarea')
    field.value = value
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  }
}

// Copies a reservation id so it can be pasted into search (here, in payments or for staff).
export function CopyIdButton({ value, label = 'Reservation ID' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!(await copyText(value))) {
      toast.error('Could not copy. Select the ID and copy it instead.')
      return
    }
    setCopied(true)
    toast.success(`${label} copied`)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()} ${value}`}
      title={`Copy ${label.toLowerCase()}`}
      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-muted transition hover:border-accent/40 hover:text-text"
    >
      {copied ? <FiCheck className="text-success" /> : <FiCopy />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// A reservation id shown short, with a copy button next to it.
export function ReservationIdTag({ id, className = '' }: { id?: string | null; className?: string }) {
  const value = String(id || '')
  if (!value) return <span className={className}>—</span>
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono" title={value}>{shortReservationId(value)}</span>
      <CopyIdButton value={value} />
    </span>
  )
}
