import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiClock, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'
import { isXenditEnabled, startXenditCheckout } from '../../utils/xendit'

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
  }
  isCaptain: boolean
  captainName: string
  myShareDue: number
  iHavePaid: boolean
  progress: { target: number; submitted: number; remaining: number; state: string }
  members?: SplitMember[]
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

function formatDue(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

// A teammate pays their share online through Xendit; it's verified automatically and the booking
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
          <div className="flex items-center gap-1 text-xs text-muted">
            <FiClock /> Pay before {formatDue(item.reservation.paymentDueAtISO)}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-bold">Pay online</div>
        <div className="text-xs text-muted">Pay with GCash, Maya, your bank, or a card on Xendit (test mode). Your share is verified automatically, and the booking is confirmed once every share is in.</div>
        {xendit === false ? (
          <div className="text-xs text-danger">Online payment is not available right now. Please try again later or contact the staff.</div>
        ) : null}
        <Button variant="primary" disabled={submitting || xendit !== true} onClick={payOnline}>
          {submitting ? 'Opening Xendit…' : `Pay my share (${formatPHP(item.myShareDue)})`}
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
              <li key={member.id} className="flex items-center gap-1.5 text-warning">
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

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: SplitPaymentItem[] }>('/api/split-payments/mine')
      setItems(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      toast.error(e?.message || 'Could not load split payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-accent">Payment</div>
        <h1 className="mt-1 text-3xl font-bold">Split Payment</h1>
        <p className="mt-1 text-sm text-muted">Pay your share of a team reservation. This page disappears from the menu once your share is paid.</p>
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
                {item.isCaptain ? 'You are the team captain' : `Captain: ${item.captainName}`} · Reservation total {formatPHP(item.reservation.totalAmount)} · Due online {formatPHP(item.progress.target)}
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

          {item.isCaptain ? <CaptainTracker item={item} /> : null}
        </Card>
      ))}
    </div>
  )
}
