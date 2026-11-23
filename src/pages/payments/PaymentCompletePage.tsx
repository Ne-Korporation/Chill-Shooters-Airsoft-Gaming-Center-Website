import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FiAlertTriangle, FiCheckCircle, FiClock, FiLoader, FiXCircle } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiPost } from '../../utils/apiClient'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { DEMO_PAY_CHANNEL, demoPayUrl } from '../../utils/xendit'

type VerifyResult = {
  status: 'paid' | 'unpaid'
  reservationId?: string
  reservationIds?: string[]
  reservationStatus?: string
  paymentState?: string
  waitingForGuardian?: boolean
  balanceDue?: number
  amount?: number
}

// Xendit can mark an invoice paid a moment after the player is redirected back,
// so an unpaid answer is retried a few times before telling the player.
const RETRIES = 6
const RETRY_MS = 2500
// While the payment tab is open, this page keeps checking (up to 30 minutes).
const WAITING_RETRIES = 720

const peso = (value?: number) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

// Where Xendit sends the player back after paying (or failing to pay).
export function PaymentCompletePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const ref = params.get('ref') || ''
  // waiting=1: the GCash / QR Ph screen is open in another tab and this tab waits for it.
  const waiting = params.get('waiting') === '1'
  const [cancelledHere, setCancelledHere] = useState(false)
  const cancelled = params.get('cancelled') === '1' || cancelledHere
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkNow, setCheckNow] = useState(0)

  // The payment tab says when it paid (check at once) or was cancelled.
  useEffect(() => {
    if (!waiting || typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(DEMO_PAY_CHANNEL)
    channel.onmessage = (event) => {
      if (event.data?.ref !== ref) return
      if (event.data.type === 'paid') setCheckNow((n) => n + 1)
      if (event.data.type === 'cancelled') setCancelledHere(true)
    }
    return () => channel.close()
  }, [waiting, ref])

  useEffect(() => {
    if (!ref) {
      setError('This page needs a payment reference.')
      return
    }
    let stop = false
    const check = async (attempt: number) => {
      try {
        const res = await apiPost<{ ok: boolean; data: VerifyResult }>('/api/xendit/verify', { ref })
        if (stop) return
        if (res.data.status === 'unpaid' && !cancelled && attempt < (waiting ? WAITING_RETRIES : RETRIES)) {
          if (waiting) setResult(res.data)
          window.setTimeout(() => void check(attempt + 1), RETRY_MS)
          return
        }
        setResult(res.data)
      } catch (e: any) {
        if (!stop) setError(e?.message || 'Could not check the payment.')
      }
    }
    void check(1)
    return () => { stop = true }
  }, [ref, cancelled, waiting, checkNow])

  const confirmed = result?.status === 'paid' && ['confirmed', 'approved'].includes(String(result.reservationStatus || '').toLowerCase())
  const waitingGuardian = result?.status === 'paid' && !confirmed && result.waitingForGuardian
  const paidOther = result?.status === 'paid' && !confirmed && !waitingGuardian
  const waitingForTab = waiting && !cancelled && (!result || result.status === 'unpaid')

  // Nothing was paid, so the booking hasn't gone through: the player can cancel it right here
  // (the server checks it's theirs and still unpaid). A full day cancels every slot in it.
  const [cancelling, setCancelling] = useState(false)
  const [bookingCancelled, setBookingCancelled] = useState(false)
  const unpaidIds = result?.status === 'unpaid'
    ? (result.reservationIds?.length ? result.reservationIds : [result.reservationId || '']).filter(Boolean)
    : []
  const cancelBooking = async () => {
    if (!(await confirmDialog({
      title: unpaidIds.length > 1 ? 'Cancel these reservations?' : 'Cancel this reservation?',
      message: `Nothing has been paid, so ${unpaidIds.length > 1 ? `all ${unpaidIds.length} slots are` : 'the booking is'} cancelled and the slot opens for anyone to book. This can't be undone.`,
      confirmLabel: 'Cancel reservation',
      cancelLabel: 'Keep it',
      danger: true,
    }))) return
    setCancelling(true)
    try {
      for (const id of unpaidIds) await apiPost(`/api/reservations/${encodeURIComponent(id)}/cancel`, {})
      setBookingCancelled(true)
      toast.success(unpaidIds.length > 1 ? 'Reservations cancelled.' : 'Reservation cancelled.')
    } catch (err: any) {
      toast.error(err?.message || 'Could not cancel the reservation')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold">Payment</h1>
      <Card className="space-y-3 p-5">
        {error ? (
          <div className="flex items-start gap-3 text-danger"><FiAlertTriangle className="mt-1 shrink-0" /> <div>{error}</div></div>
        ) : waitingForTab ? (
          <>
            <div className="flex items-center gap-2 text-lg font-bold text-accent"><FiLoader className="animate-spin" /> Waiting for your payment</div>
            <p className="text-sm">Finish paying in the GCash / QR Ph tab that just opened. This page updates by itself as soon as the payment goes through.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => window.open(demoPayUrl(ref), '_blank')}>Reopen payment tab</Button>
              <Button variant="ghost" onClick={() => setCancelledHere(true)}>Cancel payment</Button>
            </div>
          </>
        ) : !result ? (
          <div className="flex items-center gap-3 text-muted"><FiLoader className="animate-spin" /> Checking your payment…</div>
        ) : confirmed ? (
          <>
            <div className="flex items-center gap-2 text-lg font-bold text-success"><FiCheckCircle /> Payment successful</div>
            <p className="text-sm">Your payment of {peso(result.amount)} was verified and your reservation is <b>confirmed</b>.</p>
            {result.balanceDue ? (
              <p className="text-sm text-muted">Please pay the remaining <b>{peso(result.balanceDue)}</b> at the counter on game day by cash, GCash, or bank transfer.</p>
            ) : null}
          </>
        ) : waitingGuardian ? (
          <>
            <div className="flex items-center gap-2 text-lg font-bold text-accent"><FiClock /> Payment received</div>
            <p className="text-sm">Your payment of {peso(result.amount)} was verified. A player on this booking is under 18, so it is confirmed as soon as their guardian approves it by email.</p>
          </>
        ) : paidOther ? (
          <>
            <div className="flex items-center gap-2 text-lg font-bold text-success"><FiCheckCircle /> Payment received</div>
            <p className="text-sm">
              Your payment of {peso(result.amount)} was verified.{' '}
              {result.paymentState === 'finalized'
                ? 'Staff will finish confirming your reservation.'
                : 'Your teammates still need to pay their shares before the reservation is confirmed.'}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-lg font-bold text-warning"><FiAlertTriangle /> {cancelled ? 'Payment cancelled' : 'Payment not completed'}</div>
            {bookingCancelled ? (
              <p className="text-sm">No money was taken, and your reservation is <b>cancelled</b>. The slot is open for anyone to book again.</p>
            ) : (
              <>
                <p className="text-sm">No money was taken. Your reservation is saved but not paid yet; pay from <b>My Reservations</b> before the deadline shown there, or the slot is released.</p>
                {unpaidIds.length ? (
                  <p className="text-sm text-muted">Changed your mind? You can cancel it now, since nothing has been paid.</p>
                ) : null}
              </>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="primary" onClick={() => navigate('/app/my-reservations')}>My Reservations</Button>
          <Button variant="ghost" onClick={() => navigate('/app')}>Dashboard</Button>
          {unpaidIds.length && !bookingCancelled && !waitingForTab ? (
            <Button variant="danger-soft" disabled={cancelling} onClick={() => void cancelBooking()}>
              <FiXCircle /> {cancelling ? 'Cancelling…' : 'Cancel reservation'}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
