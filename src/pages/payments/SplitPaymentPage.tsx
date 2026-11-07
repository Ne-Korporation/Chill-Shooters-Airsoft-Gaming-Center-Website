import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiClock, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'
import { isXenditEnabled, startXenditCheckout } from '../../utils/xendit'
import { isPrivateSession } from '../../utils/bookingRoles'

export const SPLIT_PAYMENTS_CHANGED_EVENT = 'split-payments-changed'

type SplitMember = {
  id: string
  name: string
  isCaptain: boolean
  paid: boolean
  amount: number
  paymentStatus: string | null
}

export type SplitPaymentItem = {
  reservation: {
    id: string
    reservationDate: string
    reservationTime: string
    locationName: string
    numberOfPlayers: number
    packageName: string
    totalAmount: number
    depositAmount: number
    paymentDueAtISO?: string
    sessionType?: string
  }
  isCaptain: boolean
  captainName: string
  myShareDue: number
  iHavePaid: boolean
  progress: { target: number; submitted: number; remaining: number; state: string; paidCount?: number; payerCount?: number }
  members?: SplitMember[]
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

// How often the page re-reads the team's payments, so a teammate's share shows up on its own.
const REFRESH_MS = 10_000

// "3h 20m left" / "12m left" until the deadline (re-rendered every refresh).
function timeLeft(iso?: string) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Deadline passed'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${Math.max(1, minutes)}m left`
}

function formatDue(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

// A teammate pays their share online (GCash or QR Ph demo page); it's verified automatically and the booking
// is confirmed once every share is in.
function ShareForm({ item }: { item: SplitPaymentItem }) {
  const [submitting, setSubmitting] = useState(false)
  // null while checking whether the server has Xendit set up.
  const [xendit, setXendit] = useState<boolean | null>(null)
  useEffect(() => {
    void isXenditEnabled().then(setXendit).catch(() => setXendit(false))
  }, [])

  const payOnline = async () => {
    setSubmitting(true)
    try {
      await startXenditCheckout(item.reservation.id)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the payment page. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Your share due</div>
          <div className="mt-1 text-2xl font-bold text-gold">{formatPHP(item.myShareDue)}</div>
        </div>
        {item.reservation.paymentDueAtISO ? (
          <div className={`flex items-center gap-1 text-xs ${new Date(item.reservation.paymentDueAtISO).getTime() - Date.now() < 2 * 3600_000 ? 'font-semibold text-danger' : 'text-muted'}`}>
            <FiClock /> Pay before {formatDue(item.reservation.paymentDueAtISO)} · {timeLeft(item.reservation.paymentDueAtISO)}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-bold">Pay online</div>
        <div className="text-xs text-muted">Pay with GCash or QR Ph (demo: no real money is sent). Your share is verified automatically, and the booking is confirmed once every share is in.</div>
        {xendit === false ? (
          <div className="text-xs text-danger">Online payment is not available right now. Please try again later or contact the staff.</div>
        ) : null}
        <Button variant="primary" disabled={submitting || xendit !== true} onClick={payOnline}>
          {submitting ? 'Opening payment…' : `Pay my share (${formatPHP(item.myShareDue)})`}
        </Button>
      </div>
    </div>
  )
}

function CaptainTracker({ item }: { item: SplitPaymentItem }) {
  const pct = item.progress.target > 0 ? Math.min(100, Math.round((item.progress.submitted / item.progress.target) * 100)) : 0
  const members = item.members || []
  const paid = members.filter((member) => member.paid)
  const pending = members.filter((member) => !member.paid)

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><FiUsers /> Team payment tracker</div>
      <div className="mt-3 flex items-end justify-between gap-3 text-xs text-muted">
        <span>{formatPHP(item.progress.submitted)} of {formatPHP(item.progress.target)} submitted</span>
        <span className="text-sm font-bold text-text">{formatPHP(item.progress.remaining)} remaining</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Paid ({paid.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {paid.length === 0 ? <li className="text-xs text-muted">No one yet</li> : paid.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><FiCheck className="text-success" />{member.name}{member.isCaptain ? ' (you)' : ''}</span>
                <span className="text-xs text-muted">{formatPHP(member.amount)}{member.paymentStatus === 'pending' || member.paymentStatus === 'review' ? ' · in review' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Pending ({pending.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {pending.length === 0 ? <li className="text-xs text-muted">Everyone has paid</li> : pending.map((member) => (
              <li key={member.id} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <FiClock />{member.name}{member.isCaptain ? ' (you)' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 text-xs text-muted">
        Once every share is paid, the reservation is confirmed automatically.
      </div>
    </div>
  )
}

export function SplitPaymentPage() {
  const [items, setItems] = useState<SplitPaymentItem[]>([])
  const [loading, setLoading] = useState(true)

  // What was on screen last time, to spot teammates who just paid.
  const previousRef = useRef<SplitPaymentItem[] | null>(null)

  const load = useCallback(async (background = false) => {
    try {
      const res = await apiGet<{ ok: boolean; data: SplitPaymentItem[] }>('/api/split-payments/mine')
      const next = Array.isArray(res?.data) ? res.data : []
      const previous = previousRef.current
      if (previous && background) {
        for (const before of previous) {
          const after = next.find((item) => item.reservation.id === before.reservation.id)
          const label = `${before.reservation.reservationDate} (${before.reservation.reservationTime})`
          if (!after) {
            // Gone from the list: every share is in (or, for a teammate, theirs was the last).
            toast.success(`Payment complete for ${label}.`)
            continue
          }
          const newlyPaid = (after.members || []).filter((member) =>
            member.paid && !member.isCaptain && !(before.members || []).find((old) => old.id === member.id)?.paid)
          newlyPaid.forEach((member) => toast.success(`${member.name} paid their share.`))
          if (!after.members && (after.progress.paidCount || 0) > (before.progress.paidCount || 0)) {
            toast.success(`A teammate paid their share (${after.progress.paidCount} of ${after.progress.payerCount}).`)
          }
        }
        if (previous.length !== next.length) window.dispatchEvent(new Event(SPLIT_PAYMENTS_CHANGED_EVENT))
      }
      previousRef.current = next
      setItems(next)
    } catch (e: any) {
      if (!background) toast.error(e?.message || 'Could not load split payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    const timer = window.setInterval(refresh, REFRESH_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-accent">Payment</div>
        <h1 className="mt-1 text-3xl font-bold">Split Payment</h1>
        <p className="mt-1 text-sm text-muted">Pay your share of a team reservation. The team has 24 hours to pay; this page updates on its own as teammates pay and disappears from the menu once your share is paid.</p>
      </div>

      {loading ? <Card className="p-4 text-sm text-muted">Loading…</Card> : null}
      {!loading && items.length === 0 ? (
        <Card className="p-4 text-sm text-muted">You have no split payments due. You're all set.</Card>
      ) : null}

      {items.map((item) => (
        <Card key={item.reservation.id} className="p-4 md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg font-semibold">
                {item.reservation.reservationDate} · <span className="capitalize">{item.reservation.reservationTime}</span>
              </div>
              <div className="mt-1 text-sm text-muted">
                {item.reservation.locationName} · {item.reservation.numberOfPlayers} players · {item.reservation.packageName}
              </div>
              <div className="mt-1 text-xs text-muted">
                {isPrivateSession(item.reservation.sessionType) ? (item.isCaptain ? 'You are the team captain' : `Captain: ${item.captainName}`) : (item.isCaptain ? 'You booked this game' : `Booked by ${item.captainName}`)} · Reservation total {formatPHP(item.reservation.totalAmount)} · Due online {formatPHP(item.progress.target)}
              </div>
            </div>
            <span className="self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
              {item.progress.state === 'partial' ? 'Partially paid' : 'Awaiting payment'}
            </span>
          </div>

          {!item.iHavePaid && item.myShareDue > 0 ? (
            <ShareForm item={item} />
          ) : item.iHavePaid ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-success">
              <FiCheck /> Your share is submitted.
            </div>
          ) : null}

          {item.isCaptain ? <CaptainTracker item={item} /> : item.progress.payerCount ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5 font-semibold text-text"><FiUsers /> Team progress</span>
                <span>{item.progress.paidCount || 0} of {item.progress.payerCount} shares in</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.min(100, Math.round(((item.progress.paidCount || 0) / item.progress.payerCount) * 100))}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-muted">Updates on its own as teammates pay.</div>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  )
}
