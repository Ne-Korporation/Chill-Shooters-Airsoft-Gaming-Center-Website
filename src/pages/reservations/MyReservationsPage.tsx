import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiCalendar, FiLock, FiPrinter, FiRefreshCw } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { isVerifiedPayment, printReceipt, type ReceiptPayment } from '../../utils/receiptPrint'
import { clearBookingDraft, draftTimeLeft, markBookingDraftLeft, readBookingDraft, type BookingDraft } from '../../utils/bookingDraft'
import { isPaymongoEnabled, startPaymongoCheckout } from '../../utils/paymongo'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type RescheduleEvent = {
  fromDate?: string
  fromTime?: string
  toDate?: string
  toTime?: string
  reason?: string
  atISO?: string
}

type ReservationDoc = {
  id?: string
  _id?: string
  reservationDate?: string
  dateISO?: string
  reservationTime?: string
  slot?: string
  reservationStatus?: string
  locationName?: string
  locationId?: string
  sessionType?: string
  numberOfPlayers?: number
  packageName?: string
  totalAmount?: number
  depositAmount?: number
  rescheduleHistory?: RescheduleEvent[]
  paymentMode?: string
  paymentState?: 'awaiting' | 'partial' | 'finalized'
  paymentDueAtISO?: string
  cancellationReason?: string
  pricingBreakdown?: Array<{ label?: string; amount?: number }>
  sentBack?: { note: string; atISO: string }
}

type PaymentDoc = ReceiptPayment & { reservationId?: string }

const RESCHEDULE_CUTOFF_DAYS = 3
const RESCHEDULABLE_STATUSES = ['pending', 'needs review', 'confirmed']
// No-cancellation policy: players cannot cancel, but may transfer to another date
// (reschedule) up to RESCHEDULE_CUTOFF_DAYS before the game, with the deposit carried over.
const OPEN_STATUSES = ['pending', 'needs review', 'confirmed']
const SLOTS = ['morning', 'afternoon', 'evening'] as const

function manilaTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function addDaysISO(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetweenISO(fromISO: string, toISO: string) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000)
}

function isWeekdayISO(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function reservationIdOf(reservation: ReservationDoc) {
  return String(reservation.id || reservation._id || '')
}

function dateOf(reservation: ReservationDoc) {
  return String(reservation.reservationDate || reservation.dateISO || '')
}

function slotOf(reservation: ReservationDoc) {
  return String(reservation.reservationTime || reservation.slot || '').toLowerCase()
}

function statusOf(reservation: ReservationDoc) {
  return String(reservation.reservationStatus || 'pending').toLowerCase()
}

function formatPHP(value?: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

export function MyReservationsPage() {
  const slotHours = useSlotHours()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [payments, setPayments] = useState<PaymentDoc[]>([])
  const today = manilaTodayISO()
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newSlot, setNewSlot] = useState<string>('morning')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, paymentsRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200').catch(() => ({ ok: false, data: [] as PaymentDoc[] })),
      ])
      setReservations(Array.isArray(res?.data) ? res.data : [])
      setPayments(Array.isArray(paymentsRes?.data) ? paymentsRes.data : [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load your reservations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Unpaid reservations can be paid online from here (e.g. after cancelling at PayMongo).
  const [canPayOnline, setCanPayOnline] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  useEffect(() => {
    void isPaymongoEnabled().then(setCanPayOnline)
  }, [])
  const payOnline = async (reservationId: string) => {
    setPayingId(reservationId)
    try {
      await startPaymongoCheckout(reservationId)
    } catch (err: any) {
      toast.error(err?.message || 'Could not open the payment page')
      setPayingId(null)
    }
  }

  // A booking the player left part-way: offered here until its one-minute grace runs out.
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const [draftSecondsLeft, setDraftSecondsLeft] = useState(0)
  useEffect(() => {
    // Read after the booking page's "left" mark lands (it fires 300 ms after leaving). Being on
    // this page means the player isn't booking, so a draft still marked active is marked left now.
    const timer = window.setTimeout(() => {
      markBookingDraftLeft(user?.id)
      const found = readBookingDraft(user?.id)
      setDraft(found)
      setDraftSecondsLeft(found ? Math.ceil(draftTimeLeft(found) / 1000) : 0)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [user?.id])
  useEffect(() => {
    if (!draft) return
    const timer = window.setInterval(() => {
      const left = Math.ceil(draftTimeLeft(draft) / 1000)
      setDraftSecondsLeft(left)
      if (left <= 0) {
        clearBookingDraft(user?.id)
        window.clearInterval(timer)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [draft, user?.id])

  const sorted = useMemo(
    () => reservations.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    [reservations],
  )

  const startEditing = (reservation: ReservationDoc) => {
    setEditingId(reservationIdOf(reservation))
    setNewDate(addDaysISO(today, 1))
    setNewSlot(slotOf(reservation) || 'morning')
    setReason('')
  }

  const submitReschedule = async (reservation: ReservationDoc) => {
    if (!newDate || newDate <= today) {
      toast.error('Choose a date after today.')
      return
    }
    if (isWeekdayISO(newDate) && String(reservation.sessionType || '').toLowerCase() !== 'private') {
      toast.error('Weekday dates are for private sessions only. Choose a Saturday or Sunday.')
      return
    }
    const sentBack = Boolean(reservation.sentBack) && statusOf(reservation) === 'needs review'
    if (!reason.trim() && !sentBack) {
      toast.error('Please give a reason for rescheduling.')
      return
    }

    setSaving(true)
    try {
      await apiPost(`/api/reservations/${encodeURIComponent(reservationIdOf(reservation))}/reschedule`, {
        reservationDate: newDate,
        reservationTime: newSlot,
        reason: reason.trim(),
      })
      toast.success(sentBack
        ? 'New date sent. Staff will review your reservation again.'
        : 'Reservation rescheduled. Your deposit carries over to the new date.')
      setEditingId(null)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to reschedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Reservations</h1>
          <p className="mt-1 text-sm text-muted">
            View your bookings and reschedule up to {RESCHEDULE_CUTOFF_DAYS} days before the game. Paid deposits carry over to the new date.
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate('/app/reservations')}>
          <FiCalendar /> New reservation
        </Button>
      </div>

      {draft && draftSecondsLeft > 0 ? (
        <Card className="flex flex-col gap-3 border-accent/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">You have an unfinished booking</div>
            <div className="mt-1 text-sm text-muted">{draft.label}</div>
            <div className="mt-1 text-xs text-warning">Your slot is kept for {draftSecondsLeft} more second{draftSecondsLeft === 1 ? '' : 's'}, then it opens up for other players.</div>
          </div>
          <Button variant="primary" onClick={() => navigate(draft.path)}>
            <FiRefreshCw /> Continue booking reservation
          </Button>
        </Card>
      ) : null}

      {loading ? <Card className="p-4 text-sm text-muted">Loading your reservations…</Card> : null}
      {!loading && sorted.length === 0 ? (
        <Card className="p-4 text-sm text-muted">You have no reservations yet.</Card>
      ) : null}

      {sorted.map((reservation) => {
        const id = reservationIdOf(reservation)
        const date = dateOf(reservation)
        const status = statusOf(reservation)
        const daysLeft = date ? daysBetweenISO(today, date) : -1
        const statusAllows = RESCHEDULABLE_STATUSES.includes(status)
        // Staff sent it back: the player can always pick a new date, whatever the cutoff.
        const sentBack = Boolean(reservation.sentBack) && status === 'needs review'
        const canReschedule = statusAllows && (sentBack || daysLeft >= RESCHEDULE_CUTOFF_DAYS)
        const blockedReason = !statusAllows
          ? `A ${status} reservation can't be rescheduled.`
          : daysLeft < RESCHEDULE_CUTOFF_DAYS
            ? `Rescheduling closes ${RESCHEDULE_CUTOFF_DAYS} days before the game.`
            : ''
        const editing = editingId === id
        const reservationPayments = payments.filter((payment) => [reservation.id, reservation._id].map(String).includes(String(payment.reservationId)))
        const hasVerifiedPayment = reservationPayments.some(isVerifiedPayment)
        const isOpen = OPEN_STATUSES.includes(status)

        return (
          <Card key={id} className="p-4 md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-lg font-semibold">
                  {date || 'No date'} · <span className="capitalize">{slotOf(reservation) || '-'}</span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  {reservation.locationName || reservation.locationId || 'Location'} · <span className="capitalize">{reservation.sessionType || 'public'}</span> · {reservation.numberOfPlayers || 0} players · {reservation.packageName || 'Custom selection'}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Total {formatPHP(reservation.totalAmount)} · Deposit {formatPHP(reservation.depositAmount)} · ID {id}
                </div>
                {sentBack ? (
                  <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    <div className="font-semibold">Staff sent this reservation back to you</div>
                    <div className="mt-1 text-text">Reason: {reservation.sentBack?.note}</div>
                    <div className="mt-1 text-xs text-muted">Choose a new date below. Staff will review it again; your deposit carries over.</div>
                  </div>
                ) : null}
                {status === 'cancelled' && reservation.cancellationReason === 'payment_window_expired' ? (
                  <div className="mt-1 text-xs text-warning">Released because payment wasn't completed in time.</div>
                ) : null}
                {isOpen && reservation.paymentState !== 'finalized' && reservation.paymentDueAtISO ? (
                  <div className="mt-1 text-xs text-muted">
                    {reservation.paymentMode === 'split' ? 'Team payment' : 'Payment'} must be complete by{' '}
                    {new Date(reservation.paymentDueAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} or the slot is released.
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
                  {status}
                </span>
                {canPayOnline && status === 'pending' && reservation.paymentState !== 'finalized' &&
                  !reservationPayments.some((payment: any) => String(payment.userId) === String(user?.id) && !['failed', 'rejected'].includes(String(payment.paymentStatus || '').toLowerCase())) ? (
                  <Button variant="primary" disabled={payingId === id} onClick={() => payOnline(id)}>
                    {payingId === id ? 'Opening PayMongo…' : 'Pay now'}
                  </Button>
                ) : null}
                {hasVerifiedPayment ? (
                  <Button variant="ghost" onClick={() => printReceipt(reservation, reservationPayments, user?.name || '').catch((err: any) => toast.error(err?.message || 'Unable to print the receipt'))}>
                    <FiPrinter /> Print receipt
                  </Button>
                ) : null}
                {!editing ? (
                  <Button variant={sentBack ? 'primary' : 'ghost'} disabled={!canReschedule} onClick={() => startEditing(reservation)}>
                    <FiRefreshCw /> {sentBack ? 'Choose a new date' : 'Reschedule'}
                  </Button>
                ) : null}
                {!canReschedule && blockedReason ? <div className="text-xs text-muted">{blockedReason}</div> : null}
                {isOpen ? (
                  <div className="flex max-w-xs items-start gap-1 text-xs text-muted md:text-right">
                    <FiLock className="mt-0.5 shrink-0" /> No cancellations — you can transfer to another date up to {RESCHEDULE_CUTOFF_DAYS} days before your game, and your deposit carries over.
                  </div>
                ) : null}
              </div>
            </div>

            {editing ? (
              <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-3">
                <label className="block text-xs font-semibold text-muted">
                  New date
                  <input
                    type="date"
                    min={addDaysISO(today, 1)}
                    value={newDate}
                    onChange={(event) => setNewDate(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text"
                  />
                </label>
                <label className="block text-xs font-semibold text-muted">
                  Time slot
                  <select
                    value={newSlot}
                    onChange={(event) => setNewSlot(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm capitalize text-text [&>option]:bg-background"
                  >
                    {SLOTS.map((slot) => <option key={slot} value={slot}>{slot} ({formatSlotRange(slotHours, slot)})</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-muted md:col-span-3">
                  {sentBack ? 'Note for staff (optional)' : 'Reason'}
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="e.g. Weather, team availability"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text"
                  />
                </label>
                <div className="flex gap-2 md:col-span-3">
                  <Button variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
                  <Button variant="primary" onClick={() => submitReschedule(reservation)} disabled={saving}>
                    {saving ? 'Saving…' : 'Confirm new schedule'}
                  </Button>
                </div>
              </div>
            ) : null}

            {reservation.rescheduleHistory?.length ? (
              <div className="mt-3 space-y-1 text-xs text-muted">
                {reservation.rescheduleHistory.map((event, index) => (
                  <div key={index}>
                    Moved from {event.fromDate} {event.fromTime} to {event.toDate} {event.toTime}
                    {event.reason ? ` — ${event.reason}` : ''}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}
