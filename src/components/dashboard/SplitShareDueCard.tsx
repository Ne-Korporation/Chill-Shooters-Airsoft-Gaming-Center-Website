import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FiAlertCircle, FiChevronRight } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'
import type { SplitPaymentItem } from '../../pages/payments/SplitPaymentPage'

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

// Dashboard card for a player added to a team with a split payment: how much they need to pay,
// for which game, and by when, with a link to pay it on the Split Payment page.
export function SplitShareDueCard() {
  const [items, setItems] = useState<SplitPaymentItem[]>([])
  useEffect(() => {
    let alive = true
    const load = () => apiGet<{ ok: boolean; data: SplitPaymentItem[] }>('/api/split-payments/mine')
      .then((res) => { if (alive) setItems(Array.isArray(res?.data) ? res.data : []) })
      .catch(() => {})
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const due = items.filter((item) => !item.iHavePaid && item.myShareDue > 0)
  if (due.length === 0) return null
  const total = due.reduce((sum, item) => sum + item.myShareDue, 0)

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
        <FiAlertCircle /> Your share to pay
      </div>
      <div className="mt-1 text-2xl font-bold text-gold">{formatPHP(total)}</div>
      <ul className="mt-2 space-y-2">
        {due.map((item) => (
          <li key={item.reservation.id} className="text-xs">
            <div className="font-semibold text-text">
              {formatPHP(item.myShareDue)} · {item.reservation.reservationDate} ({item.reservation.reservationTime})
            </div>
            <div className="text-muted">
              {item.isCaptain ? 'Your team' : `${item.captainName}'s team`}
              {item.reservation.locationName ? ` at ${item.reservation.locationName}` : ''}
              {item.reservation.paymentDueAtISO ? ` · pay before ${new Date(item.reservation.paymentDueAtISO).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </div>
          </li>
        ))}
      </ul>
      <Link
        to="/app/split-payments"
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Pay my share <FiChevronRight />
      </Link>
    </div>
  )
}
