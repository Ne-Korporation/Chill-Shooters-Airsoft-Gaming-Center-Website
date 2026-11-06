import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertCircle, FiCalendar, FiEye, FiFileText, FiRefreshCw, FiXCircle } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { isVerifiedPayment, type ReceiptPayment } from '../../utils/receiptPrint'
import { ReceiptModal } from '../../components/payments/ReceiptModal'
import { clearBookingDraft, draftTimeLeft, markBookingDraftLeft, readBookingDraft, type BookingDraft } from '../../utils/bookingDraft'
import { isXenditEnabled, startXenditCheckout } from '../../utils/xendit'
import { useSlotHours } from '../../utils/slotHours'
import { reservationStatusLabel } from '../../utils/reservationStatus'
import { RescheduleSlotPicker, isWeekdayISO } from '../../components/reservations/RescheduleSlotPicker'
import { ReservationIdTag } from '../../components/reservations/ReservationIdTag'
import { ReservationDetailsDialog, type ReservationDetails } from '../../components/reservations/ReservationDetailsDialog'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { FilterTabs } from '../../components/ui/FilterTabs'

type RescheduleEvent = {
  fromDate?: string
  fromTime?: string
  toDate?: string
  toTime?: string
  reason?: string
  atISO?: string
}

type ReservationDoc = ReservationDetails & {
  // The captain who booked it.
  userId?: string
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

function formatShortDate(iso: string) {
  return iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
}

function formatCardDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// Status chip colors: green when it's set, gold while waiting, red when it needs the player.
function statusTone(status: string) {
  if (['confirmed', 'approved', 'completed'].includes(status)) return 'bg-success/15 text-success'
  if (['needs review', 'rejected', 'declined'].includes(status)) return 'bg-danger/15 text-danger'
  if (status === 'pending') return 'bg-accent/15 text-accent'
  return 'bg-[rgba(var(--text),0.08)] text-muted'
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
  const [detailsId, setDetailsId] = useState<string | null>(null)
  // The receipt on screen: its reservation and verified payments, kept as opened.
  const [receipt, setReceipt] = useState<{ reservation: any; payments: ReceiptPayment[] } | null>(null)
  // "Review my reservation" in the confirmation email links here with ?view=<id>.
  const [searchParams, setSearchParams] = useSearchParams()
  const viewId = searchParams.get('view')
  useEffect(() => {
    if (!viewId || !reservations.some((item) => reservationIdOf(item) === viewId)) return
    setDetailsId(viewId)
    setSearchParams((params) => {
      params.delete('view')
      return params
    }, { replace: true })
  }, [viewId, reservations, setSearchParams])

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const [res, paymentsRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200').catch(() => ({ ok: false, data: [] as PaymentDoc[] })),
      ])
      setReservations(Array.isArray(res?.data) ? res.data : [])
      setPayments(Array.isArray(paymentsRes?.data) ? paymentsRes.data : [])
    } catch (err: any) {
      if (!background) toast.error(err?.message || 'Unable to load your reservations')
    } finally {
      setLoading(false)
    }
  }, [])

  // Payment status changes as teammates pay their shares, so keep it current while open.
  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    const timer = window.setInterval(refresh, 20_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  // A booking can be cancelled by its captain until any payment is made; the slot opens again.
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const cancelReservation = async (id: string, label: string) => {
    if (!window.confirm(`Cancel your reservation for ${label}? The slot opens for anyone to book. This can't be undone.`)) return
    setCancellingId(id)
    try {
      await apiPost(`/api/reservations/${encodeURIComponent(id)}/cancel`, {})
      toast.success('Reservation cancelled.')
      await load(true)
    } catch (err: any) {
      toast.error(err?.message || 'Could not cancel the reservation')
    } finally {
      setCancellingId(null)
    }
  }

  // Unpaid reservations can be paid online from here (e.g. after leaving the payment page).
  const [canPayOnline, setCanPayOnline] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  useEffect(() => {
    void isXenditEnabled().then(setCanPayOnline)
  }, [])
  const payOnline = async (reservationId: string) => {
    setPayingId(reservationId)
    try {
      await startXenditCheckout(reservationId)
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
    // Cancelled bookings are no longer listed (there is no cancellation policy).
    () => reservations.filter((reservation) => statusOf(reservation) !== 'cancelled').sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    [reservations],
  )

  // Upcoming games first (soonest on top); past games in their own tab (most recent on top).
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const upcoming = useMemo(
    () => sorted.filter((item) => !dateOf(item) || dateOf(item) >= today).sort((a, b) => (dateOf(a) || '9999').localeCompare(dateOf(b) || '9999')),
    [sorted, today],
  )
  const past = useMemo(() => sorted.filter((item) => dateOf(item) && dateOf(item) < today), [sorted, today])
  const shown = tab === 'upcoming' ? upcoming : past
  const { page, setPage, pageCount, pageItems, total } = usePagination(shown, 10, tab)

  const startEditing = (reservation: ReservationDoc) => {
    setEditingId(reservationIdOf(reservation))
    // The player picks from the calendar, which only offers open dates of the same kind.
    setNewDate('')
    setNewSlot(slotOf(reservation) || 'morning')
    setReason('')
  }

  const submitReschedule = async (reservation: ReservationDoc) => {
    if (!newDate || newDate <= today) {
      toast.error('Pick a new date from the calendar.')
      return
    }
    const originalDate = dateOf(reservation)
    if (originalDate && isWeekdayISO(originalDate) !== isWeekdayISO(newDate)) {
      toast.error(isWeekdayISO(originalDate)
        ? 'This reservation was booked on a weekday, so it can only move to another weekday.'
        : 'This reservation was booked on a weekend, so it can only move to another Saturday or Sunday.')
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
          <p className="mt-1 text-sm text-muted">Your upcoming and past games.</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            <li className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(var(--text),0.06)] px-3 py-1.5">
              <FiRefreshCw className="shrink-0 text-accent" />
              <span><span className="font-semibold">Reschedule</span> up to {RESCHEDULE_CUTOFF_DAYS} days before. Your deposit carries over.</span>
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(var(--text),0.06)] px-3 py-1.5">
              <FiXCircle className="shrink-0 text-accent" />
              <span><span className="font-semibold">Cancel</span> anytime before you pay.</span>
            </li>
          </ul>
        </div>
        <Button variant="primary" onClick={() => navigate('/app/reservations')}>
          <FiCalendar /> Book a game
        </Button>
      </div>

      <FilterTabs
        ariaLabel="Show reservations"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
          { value: 'past', label: 'Past', count: past.length },
        ]}
      />

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
      {!loading && shown.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          {tab === 'upcoming' ? 'No upcoming games.' : 'No past games yet.'}
          {tab === 'upcoming' ? (
            <div className="mt-3"><Button variant="primary" onClick={() => navigate('/app/reservations')}><FiCalendar /> Book a game</Button></div>
          ) : null}
        </Card>
      ) : null}

      {pageItems.map((reservation) => {
        const id = reservationIdOf(reservation)
        const date = dateOf(reservation)
        const status = statusOf(reservation)
        const statusLabel = reservationStatusLabel(reservation)
        const daysLeft = date ? daysBetweenISO(today, date) : -1
        const statusAllows = RESCHEDULABLE_STATUSES.includes(status)
        // Staff sent it back: the player can always pick a new date, whatever the cutoff.
        const sentBack = Boolean(reservation.sentBack) && status === 'needs review'
        const canReschedule = statusAllows && (sentBack || daysLeft >= RESCHEDULE_CUTOFF_DAYS)
        const cutoffDate = date ? addDaysISO(date, -RESCHEDULE_CUTOFF_DAYS) : ''
        const editing = editingId === id
        const reservationPayments = payments.filter((payment) => [reservation.id, reservation._id].map(String).includes(String(payment.reservationId)))
        const hasVerifiedPayment = reservationPayments.some(isVerifiedPayment)
        // Unpaid and still waiting for payment: the captain can cancel it.
        const canCancel = ['pending', 'needs review'].includes(status)
          && String(reservation.userId || '') === String(user?.id || '')
          && !reservationPayments.some((payment: any) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
        // Still owes this player's payment and can pay it online now.
        const payable = canPayOnline && status === 'pending' && reservation.paymentState !== 'finalized'
          && !reservationPayments.some((payment: any) => String(payment.userId) === String(user?.id) && !['failed', 'rejected'].includes(String(payment.paymentStatus || '').toLowerCase()))
        const needsAction = sentBack || payable

        return (
          <Card key={id} className={`p-4 md:p-5 ${needsAction ? 'border-accent/40' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-lg font-semibold">
                  {date ? formatCardDate(date) : 'No date'} · <span className="capitalize">{slotOf(reservation) || '-'}</span>
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {reservation.locationName || reservation.locationId || 'Location'} · {reservation.numberOfPlayers || 0} player{Number(reservation.numberOfPlayers) === 1 ? '' : 's'} · {reservation.packageName || 'Custom selection'} · {formatPHP(reservation.totalAmount)}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusTone(status)}`}>{statusLabel}</span>
            </div>

            {/* What the player needs to do, if anything, with the button to do it. */}
            {sentBack ? (
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <div className="flex items-center gap-1.5 font-semibold text-danger"><FiAlertCircle /> Staff sent this reservation back</div>
                  <div className="mt-0.5 text-muted">{reservation.sentBack?.note}</div>
                </div>
                {!editing ? (
                  <Button variant="primary" onClick={() => startEditing(reservation)}><FiRefreshCw /> Choose a new date</Button>
                ) : null}
              </div>
            ) : payable ? (
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <div className="flex items-center gap-1.5 font-semibold"><FiAlertCircle className="text-accent" /> Waiting for payment</div>
                  {reservation.paymentDueAtISO ? (
                    <div className="mt-0.5 text-muted">
                      Pay by {new Date(reservation.paymentDueAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} or the slot is released.
                    </div>
                  ) : null}
                </div>
                <Button variant="primary" disabled={payingId === id} onClick={() => payOnline(id)}>
                  {payingId === id ? 'Opening payment…' : `Pay ${formatPHP(reservation.depositAmount)}`}
                </Button>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDetailsId(id)}>
                <FiEye /> Details
              </Button>
              {canReschedule && !sentBack && !editing ? (
                <Button size="sm" variant="ghost" onClick={() => startEditing(reservation)}>
                  <FiRefreshCw /> Reschedule
                </Button>
              ) : null}
              {hasVerifiedPayment ? (
                <Button size="sm" variant="ghost" onClick={() => setReceipt({ reservation, payments: reservationPayments as ReceiptPayment[] })}>
                  <FiFileText /> Receipt
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  size="sm"
                  variant="danger-soft"
                  disabled={cancellingId === id}
                  onClick={() => cancelReservation(id, `${reservation.reservationDate || ''} (${reservation.reservationTime || ''})`)}
                >
                  <FiXCircle /> {cancellingId === id ? 'Cancelling…' : 'Cancel'}
                </Button>
              ) : null}
              <ReservationIdTag id={id} className="ml-auto text-[11px] text-muted" />
            </div>
            {tab === 'upcoming' && statusAllows && !sentBack && daysLeft >= 0 && daysLeft < RESCHEDULE_CUTOFF_DAYS ? (
              <div className="mt-2 text-xs text-muted">Rescheduling closed on {formatShortDate(cutoffDate)} ({RESCHEDULE_CUTOFF_DAYS} days before the game).</div>
            ) : null}

            {editing ? (
              <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-3">
                <div className="md:col-span-3">
                  <div className="mb-2 text-xs font-semibold text-muted">Choose a new date and time slot</div>
                  <RescheduleSlotPicker
                    target={{
                      locationId: String(reservation.locationId || reservation.locationName || ''),
                      sessionType: String(reservation.sessionType || 'public').toLowerCase(),
                      players: Number(reservation.numberOfPlayers || 0),
                      fieldIds: Array.isArray(reservation.fieldIds) ? reservation.fieldIds.map(String) : [],
                      originalDate: date,
                      originalSlot: slotOf(reservation),
                    }}
                    todayISO={today}
                    slotHours={slotHours}
                    date={newDate}
                    slot={newSlot}
                    onChange={(next) => {
                      setNewDate(next.date)
                      setNewSlot(next.slot)
                    }}
                  />
                </div>
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
                  <Button variant="primary" onClick={() => submitReschedule(reservation)} disabled={saving || !newDate}>
                    {saving ? 'Saving…' : 'Confirm new schedule'}
                  </Button>
                </div>
              </div>
            ) : null}

          </Card>
        )
      })}
      <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />

      {detailsId ? (() => {
        const reservation = reservations.find((item) => reservationIdOf(item) === detailsId)
        if (!reservation) return null
        const reservationPayments = payments.filter((payment) => [reservation.id, reservation._id].map(String).includes(String(payment.reservationId)))
        return (
          <ReservationDetailsDialog
            reservation={reservation}
            payments={reservationPayments as any}
            captainName={user?.name || 'You'}
            slotHours={slotHours}
            onClose={() => setDetailsId(null)}
          />
        )
      })() : null}

      {receipt ? (
        <ReceiptModal
          payment={[...receipt.payments].reverse().find(isVerifiedPayment) || receipt.payments[0]}
          reservation={receipt.reservation}
          reservationPayments={receipt.payments}
          payerName={user?.name || ''}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  )
}
