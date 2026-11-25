import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertCircle, FiCalendar, FiCheck, FiCheckCircle, FiClock, FiCreditCard, FiEye, FiFileText, FiInfo, FiRefreshCw, FiUserPlus, FiUsers, FiXCircle } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FieldError } from '../../components/ui/FieldError'
import { apiDelete, apiGet, apiPost } from '../../utils/apiClient'
import { SPLIT_PAYMENTS_CHANGED_EVENT, TeamPaymentTable, useSplitPayments, type SplitPaymentItem } from '../payments/SplitPaymentPage'
import { FILL_SPOT_EVENT, InvitationsSection, OPEN_BOOKING_EVENT } from './InvitationsSection'
import { useAuth } from '../../context/AuthContext'
import { isVerifiedPayment, paymentsOfPayer, type ReceiptPayment } from '../../utils/receiptPrint'
import { ReceiptModal } from '../../components/payments/ReceiptModal'
import { clearBookingDraft, draftTimeLeft, markBookingDraftLeft, readBookingDraft, type BookingDraft } from '../../utils/bookingDraft'
import { isXenditEnabled, startXenditCheckout } from '../../utils/xendit'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'
import { reservationStatusLabel } from '../../utils/reservationStatus'
import { RescheduleSlotPicker, isWeekdayISO } from '../../components/reservations/RescheduleSlotPicker'
import { ReservationIdTag } from '../../components/reservations/ReservationIdTag'
import { ReservationDetailsDialog, type ReservationDetails } from '../../components/reservations/ReservationDetailsDialog'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { PLAYER_RESCHEDULES_ALLOWED, playerRescheduleCount, RESCHEDULE_WINDOW_DAYS } from '../../utils/bookingWindow'

type RescheduleEvent = {
  fromDate?: string
  fromTime?: string
  toDate?: string
  toTime?: string
  reason?: string
  atISO?: string
  actorRole?: string
  sentBack?: boolean
}

type ReservationDoc = ReservationDetails & {
  // The captain who booked it.
  userId?: string
  // Kept on the booking so teammates can see who booked it.
  bookerName?: string
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
  paymentSubmittedAmount?: number
  teamSize?: number
  splitShares?: Record<string, number> | null
  // Teammates' shares the captain pays at the counter (a teammate who declined or was removed).
  captainOnsiteAmount?: number
  // Teammates' spots left open; the captain may pay for them ('covering', then 'paid').
  openSlots?: Array<{ id?: string; name?: string; amount?: number; status?: string; captainPaid?: boolean }>
  cancellationReason?: string
  pricingBreakdown?: Array<{ label?: string; amount?: number }>
  sentBack?: { note: string; atISO: string }
  // Team invites (see server/utils/teamInvites.js); the latest one per player counts.
  invites?: Array<{ playerId: string; status: string; reason?: string; answeredAtISO?: string }>
  teamMembers?: Array<{ id: string }>
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

// The player's latest invite on a booking someone else made, if any.
function myInviteOf(reservation: ReservationDoc, userId: string) {
  const mine = (reservation.invites || []).filter((invite) => String(invite.playerId) === userId)
  return mine[mine.length - 1] || null
}

// Invites the player turned down, didn't answer in time, or that closed because they were already
// playing in that slot: kept in the Archive as rejected games.
const REJECTED_INVITE_LABEL: Record<string, string> = {
  declined: 'Declined',
  expired: 'Void: not answered',
  expired_unpaid: 'Void: not paid',
  unavailable: 'Auto-declined: slot taken',
  removed: 'Removed by the captain',
}
function rejectedLabel(invite: { status: string; reason?: string } | null) {
  if (!invite || !['declined', 'expired', 'unavailable', 'removed'].includes(invite.status)) return ''
  return REJECTED_INVITE_LABEL[invite.reason || invite.status] || REJECTED_INVITE_LABEL[invite.status] || 'Rejected'
}

function formatPHP(value?: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

const round2 = (value: number) => Math.round(value * 100) / 100

// "20h 18m left" until a deadline.
function timeLeftLabel(iso?: string) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'deadline passed'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${Math.max(1, minutes)}m left`
}

function formatDeadline(iso?: string) {
  return iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

// Where a booking is, in plain words, and how many of the four steps are done.
type Stage = { label: string; tone: string; done: number }
const STEPS = ['Booked', 'Paid', 'Confirmed', 'Game day']

function BookingSteps({ done, live }: { done: number; live?: boolean }) {
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1.5" aria-label="Booking progress">
      {STEPS.map((step, index) => {
        const complete = index < done
        const current = index === done || (Boolean(live) && index === STEPS.length - 1)
        return (
          <li key={step} className="min-w-0">
            <div className={[
              'h-1.5 rounded-full',
              complete ? 'bg-success' : current ? (live ? 'animate-pulse bg-success' : 'bg-accent') : 'bg-[rgba(var(--text),0.1)]',
            ].join(' ')} />
            <div className={`mt-1 flex items-center gap-1 truncate text-[11px] ${complete ? 'text-success' : current ? 'font-semibold text-text' : 'text-muted'}`}>
              {complete ? <FiCheck className="shrink-0" /> : null}{step}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-base font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

export function MyReservationsPage() {
  const slotHours = useSlotHours()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [payments, setPayments] = useState<PaymentDoc[]>([])
  const [gameStatus, setGameStatus] = useState<Map<string, string>>(() => new Map())
  const today = manilaTodayISO()
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  // Why the picked date can't be used, shown under the calendar.
  const [dateError, setDateError] = useState('')
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
      const [res, paymentsRes, gamesRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200').catch(() => ({ ok: false, data: [] as PaymentDoc[] })),
        apiGet<{ ok: boolean; data: Array<{ reservationId?: string; Status?: string }> }>('/api/gameplay?limit=200').catch(() => ({ ok: false, data: [] })),
      ])
      setReservations(Array.isArray(res?.data) ? res.data : [])
      setPayments(Array.isArray(paymentsRes?.data) ? paymentsRes.data : [])
      // Each booking's game status, set by staff: Scheduled, Ongoing (started), Completed.
      setGameStatus(new Map((Array.isArray(gamesRes?.data) ? gamesRes.data : [])
        .filter((game) => game.reservationId)
        .map((game) => [String(game.reservationId), String(game.Status || '').toLowerCase()])))
    } catch (err: any) {
      if (!background) toast.error(err?.message || 'Unable to load your reservations')
    } finally {
      setLoading(false)
    }
  }, [])

  useLiveRefresh(['reservations', 'payments', 'games'], () => load(true))
  // Declining a team booking (in the split payments above) takes it off this list.
  useEffect(() => {
    const reload = () => { void load(true) }
    window.addEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, reload)
    return () => window.removeEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, reload)
  }, [load])

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
    if (!(await confirmDialog({
      title: 'Cancel this reservation?',
      message: `Your reservation for ${label} will be cancelled and the slot opens for anyone to book. This can't be undone.`,
      confirmLabel: 'Cancel reservation',
      cancelLabel: 'Keep it',
      danger: true,
    }))) return
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

  // A teammate drops out of a game that hasn't gone through yet (nothing paid by them).
  const leaveGame = async (id: string, label: string, captainName: string) => {
    if (!(await confirmDialog({
      title: 'Leave this game?',
      message: `You'll be taken off ${captainName}'s game on ${label}, and ${captainName} is told. This can't be undone; they'd have to invite you again.`,
      confirmLabel: 'Leave game',
      cancelLabel: 'Stay',
      danger: true,
    }))) return
    setCancellingId(id)
    try {
      await apiPost(`/api/reservations/${encodeURIComponent(id)}/decline`, {})
      toast.success('You left the game.')
      await load(true)
    } catch (err: any) {
      toast.error(err?.message || 'Could not leave the game')
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
    // Read after the booking page's "left" mark lands (it fires 300 ms after leaving).
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (!readBookingDraft(user?.id)) return
      // The server's hold is what keeps the slot. A draft left behind in this browser (e.g. the
      // player logged out or closed the tab long ago) must not restart the countdown once the
      // hold is gone.
      const hold = await apiGet<{ ok: boolean; data: unknown }>('/api/slot-holds/mine').then((res) => res?.data || null).catch(() => null)
      if (cancelled) return
      if (!hold) {
        clearBookingDraft(user?.id)
        return
      }
      // Being on this page means the player isn't booking, so a draft still marked active is marked left now.
      markBookingDraftLeft(user?.id)
      const found = readBookingDraft(user?.id)
      setDraft(found)
      setDraftSecondsLeft(found ? Math.ceil(draftTimeLeft(found) / 1000) : 0)
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [user?.id])
  // The server's view: a slot still held for this player (booking started on another device, or
  // the draft here was already cleared). Shown so it can be cancelled without waiting.
  type HeldSlot = { locationId: string; reservationDate: string; reservationTime: string; sessionType: string; expiresAtISO: string }
  const [heldSlot, setHeldSlot] = useState<HeldSlot | null>(null)
  const loadHeldSlot = useCallback(() => {
    apiGet<{ ok: boolean; data: HeldSlot | null }>('/api/slot-holds/mine')
      .then((res) => setHeldSlot(res?.data || null))
      .catch(() => setHeldSlot(null))
  }, [])
  useEffect(() => { loadHeldSlot() }, [loadHeldSlot])
  useLiveRefresh(['slots'], loadHeldSlot)

  // Cancel a booking left part-way (before any reservation or payment): the slot opens for
  // everyone now instead of when the hold times out. A reservation already created at the
  // payment step is listed below with its own Cancel button.
  const [cancellingDraft, setCancellingDraft] = useState(false)
  const cancelUnfinishedBooking = async () => {
    if (!(await confirmDialog({
      title: 'Cancel this unfinished booking?',
      message: 'The slot will be opened for other players.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep it',
      danger: true,
    }))) return
    setCancellingDraft(true)
    try {
      await apiDelete('/api/slot-holds/mine')
      clearBookingDraft(user?.id)
      // The unsent booking details go too. A reservation already created keeps its id: it is
      // listed below and cancelled with its own button.
      localStorage.removeItem('pending_reservation')
      setDraft(null)
      setHeldSlot(null)
      toast.success('Booking cancelled. The slot is open again.')
    } catch (err: any) {
      toast.error(err?.message || 'Could not cancel the booking')
    } finally {
      setCancellingDraft(false)
    }
  }

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

  // Team (split) payments, shown on each booking's card and, with who pays what, in its View.
  const { items: splitItems, reload: reloadSplit } = useSplitPayments()
  const splitById = useMemo(() => new Map(splitItems.map((item) => [String(item.reservation.id), item])), [splitItems])
  // The open booking's team payment when it isn't in the live list above (fully paid, confirmed,
  // played, or a teammate who already paid): read once for the View, so every team booking shows
  // who pays what the same way.
  const [viewedTeam, setViewedTeam] = useState<SplitPaymentItem | null>(null)
  const loadViewedTeam = useCallback(async (id: string | null) => {
    setViewedTeam(null)
    if (!id || splitById.has(id)) return
    const booking = reservations.find((item) => reservationIdOf(item) === id)
    if (!booking || String(booking.paymentMode || 'self').toLowerCase() !== 'split') return
    const res = await apiGet<{ ok: boolean; data: SplitPaymentItem | null }>(`/api/reservations/${encodeURIComponent(String(booking.id || id))}/team-payment`).catch(() => null)
    setViewedTeam(res?.data || null)
  }, [splitById, reservations])
  useEffect(() => { void loadViewedTeam(detailsId) }, [detailsId]) // eslint-disable-line react-hooks/exhaustive-deps

  // "View" on an open spot opens the same booking view as the card's.
  useEffect(() => {
    const open = (event: Event) => {
      const id = String((event as CustomEvent).detail || '')
      if (id) setDetailsId(id)
    }
    window.addEventListener(OPEN_BOOKING_EVENT, open)
    return () => window.removeEventListener(OPEN_BOOKING_EVENT, open)
  }, [])

  const me = String(user?.id || '')
  // Games the player turned down (or whose invite closed): only shown in the Archive.
  const rejectedOf = useCallback((reservation: ReservationDoc) => (
    String(reservation.userId || '') === me ? '' : rejectedLabel(myInviteOf(reservation, me))
  ), [me])
  // An invite still waiting for an answer is shown under Game invites, not as one of the player's games.
  const awaitingAnswer = useCallback((reservation: ReservationDoc) => (
    String(reservation.userId || '') !== me && myInviteOf(reservation, me)?.status === 'pending'
  ), [me])
  const sorted = useMemo(
    // Cancelled bookings are no longer listed (there is no cancellation policy).
    () => reservations
      .filter((reservation) => statusOf(reservation) !== 'cancelled' && !rejectedOf(reservation) && !awaitingAnswer(reservation))
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    [reservations, rejectedOf, awaitingAnswer],
  )
  const rejected = useMemo(
    () => reservations.filter((reservation) => rejectedOf(reservation)).sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    [reservations, rejectedOf],
  )

  // Ongoing: games staff have started and not finished yet. Then upcoming games (soonest on top);
  // played and rejected games in the Archive (most recent on top).
  const [tab, setTab] = useState<'ongoing' | 'upcoming' | 'pending' | 'archive'>('upcoming')
  const gameStatusOf = (item: ReservationDoc) => gameStatus.get(reservationIdOf(item)) || ''
  const isOngoing = (item: ReservationDoc) => gameStatusOf(item).startsWith('ongo')
  const isPlayed = (item: ReservationDoc) => gameStatusOf(item).startsWith('complet')
  const ongoing = useMemo(() => sorted.filter(isOngoing), [sorted, gameStatus])
  // Open the Ongoing tab while a game is being played.
  const sawOngoing = React.useRef(false)
  useEffect(() => {
    if (ongoing.length && !sawOngoing.current) {
      sawOngoing.current = true
      setTab('ongoing')
    }
  }, [ongoing.length])
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'confirmed' | 'rejected'>('all')
  // Games still ahead, soonest first; split into confirmed (Upcoming) and not yet confirmed (Pending:
  // waiting for payment or for review).
  const ahead = useMemo(
    () => sorted
      .filter((item) => (!dateOf(item) || dateOf(item) >= today) && !isOngoing(item) && !isPlayed(item))
      .sort((a, b) => (dateOf(a) || '9999').localeCompare(dateOf(b) || '9999')),
    [sorted, today, gameStatus],
  )
  const isPending = (item: ReservationDoc) => ['pending', 'needs review'].includes(String(item.reservationStatus || '').toLowerCase())
  const pending = useMemo(() => ahead.filter(isPending), [ahead])
  const upcoming = useMemo(() => ahead.filter((item) => !isPending(item)), [ahead])
  // Played: the date has passed, or staff marked today's game done (a game still going stays in Ongoing).
  const past = useMemo(
    () => sorted.filter((item) => !isOngoing(item) && ((dateOf(item) && dateOf(item) < today) || isPlayed(item))),
    [sorted, today, gameStatus],
  )
  // Archive: games already played (confirmed) and games the player rejected, newest first.
  const archive = useMemo(
    () => [...past, ...rejected].sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    [past, rejected],
  )
  const archiveShown = archiveFilter === 'confirmed' ? past : archiveFilter === 'rejected' ? rejected : archive
  const shown = tab === 'ongoing' ? ongoing : tab === 'upcoming' ? upcoming : tab === 'pending' ? pending : archiveShown
  const { page, setPage, pageCount, pageItems, total } = usePagination(shown, 10, `${tab}|${archiveFilter}`)

  // Links to a team payment (notifications, the dashboard: #split-payments) open the booking that
  // needs paying: its tab, scrolled into view.
  const jumpedToShare = React.useRef(false)
  useEffect(() => {
    if (jumpedToShare.current || window.location.hash !== '#split-payments' || !splitItems.length || loading) return
    const owed = splitItems.find((item) => !item.iHavePaid && item.myShareDue > 0) || splitItems[0]
    const target = sorted.find((item) => String(item.id) === String(owed.reservation.id))
    if (!target) return
    jumpedToShare.current = true
    setTab(isOngoing(target) ? 'ongoing' : isPending(target) ? 'pending' : 'upcoming')
    window.setTimeout(() => document.getElementById(`booking-${reservationIdOf(target)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }, [splitItems, sorted, loading])

  const startEditing = (reservation: ReservationDoc) => {
    setEditingId(reservationIdOf(reservation))
    // The player picks from the calendar, which only offers open dates of the same kind.
    setNewDate('')
    setDateError('')
    setNewSlot(slotOf(reservation) || 'morning')
    setReason('')
  }

  const submitReschedule = async (reservation: ReservationDoc) => {
    if (!newDate || newDate <= today) {
      setDateError('Pick a new date from the calendar.')
      return
    }
    const originalDate = dateOf(reservation)
    if (originalDate && isWeekdayISO(originalDate) !== isWeekdayISO(newDate)) {
      setDateError(isWeekdayISO(originalDate)
        ? 'This reservation was booked on a weekday, so it can only move to another weekday.'
        : 'This reservation was booked on a weekend, so it can only move to another Saturday or Sunday.')
      return
    }
    if (isWeekdayISO(newDate) && String(reservation.sessionType || '').toLowerCase() !== 'private') {
      setDateError('Weekday dates are for private sessions only. Choose a Saturday or Sunday.')
      return
    }
    const sentBack = Boolean(reservation.sentBack) && statusOf(reservation) === 'needs review'

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
          <p className="mt-1 text-sm text-muted">Your upcoming games, invites, and archive.</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            <li className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(var(--text),0.06)] px-3 py-1.5">
              <FiRefreshCw className="shrink-0 text-accent" />
              <span><span className="font-semibold">Reschedule once</span>, up to {RESCHEDULE_CUTOFF_DAYS} days before, to a date within {RESCHEDULE_WINDOW_DAYS} days of the original. Your deposit carries over.</span>
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

      {/* Invites to answer and open spots to fill (shown only while there is one). Team payments
          are on each booking's card below. */}
      <InvitationsSection />

      <FilterTabs
        ariaLabel="Show reservations"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ongoing', label: 'Ongoing', count: ongoing.length },
          { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
          { value: 'pending', label: 'Pending', count: pending.length },
          { value: 'archive', label: 'Archive', count: archive.length },
        ]}
      />

      {tab === 'archive' ? (
        <FilterTabs
          ariaLabel="Filter the archive"
          value={archiveFilter}
          onChange={setArchiveFilter}
          options={[
            { value: 'all', label: 'All', count: archive.length },
            { value: 'confirmed', label: 'Confirmed', count: past.length },
            { value: 'rejected', label: 'Rejected', count: rejected.length },
          ]}
        />
      ) : null}

      {draft && draftSecondsLeft > 0 ? (
        <Card className="flex flex-col gap-3 border-accent/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">You have an unfinished booking</div>
            <div className="mt-1 text-sm text-muted">{draft.label}</div>
            <div className="mt-1 text-xs text-warning">Your slot is kept for {draftSecondsLeft} more second{draftSecondsLeft === 1 ? '' : 's'}, then it opens up for other players.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-soft" disabled={cancellingDraft} onClick={cancelUnfinishedBooking}>
              <FiXCircle /> {cancellingDraft ? 'Cancelling…' : 'Cancel booking'}
            </Button>
            <Button variant="primary" onClick={() => navigate(draft.path)}>
              <FiRefreshCw /> Continue booking reservation
            </Button>
          </div>
        </Card>
      ) : heldSlot ? (
        <Card className="flex flex-col gap-3 border-accent/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">A slot is being held for your unfinished booking</div>
            <div className="mt-1 text-sm capitalize text-muted">{heldSlot.reservationDate} · {heldSlot.reservationTime} · {heldSlot.locationId} · {heldSlot.sessionType}</div>
            <div className="mt-1 text-xs text-warning">Held until {new Date(heldSlot.expiresAtISO).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}. Cancel it to open the slot for other players now.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-soft" disabled={cancellingDraft} onClick={cancelUnfinishedBooking}>
              <FiXCircle /> {cancellingDraft ? 'Cancelling…' : 'Cancel booking'}
            </Button>
            <Button variant="primary" onClick={() => navigate('/app/reservations')}>
              <FiRefreshCw /> Continue booking
            </Button>
          </div>
        </Card>
      ) : null}

      {loading ? <Card className="p-4 text-sm text-muted">Loading your reservations…</Card> : null}
      {!loading && shown.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          {tab === 'ongoing'
            ? 'No game in progress. Your game shows here once staff start it on game day.'
            : tab === 'upcoming'
            ? (pending.length ? `No confirmed games yet. ${pending.length} booking${pending.length === 1 ? ' is' : 's are'} pending.` : 'No upcoming games.')
            : tab === 'pending' ? 'Nothing pending. Bookings waiting for payment or review show here.'
              : archiveFilter === 'rejected' ? 'No rejected games. Invites you decline, or that expire, show here.'
                : archiveFilter === 'confirmed' ? 'No played games yet.' : 'Nothing in the archive yet.'}
          {tab === 'upcoming' && !pending.length ? (
            <div className="mt-3"><Button variant="primary" onClick={() => navigate('/app/reservations')}><FiCalendar /> Book a game</Button></div>
          ) : null}
        </Card>
      ) : null}

      {pageItems.map((reservation) => {
        const id = reservationIdOf(reservation)
        const date = dateOf(reservation)
        const rejectedAs = rejectedOf(reservation)
        const status = rejectedAs ? 'rejected' : statusOf(reservation)
        const statusLabel = rejectedAs || reservationStatusLabel(reservation)
        const daysLeft = date ? daysBetweenISO(today, date) : -1
        const statusAllows = RESCHEDULABLE_STATUSES.includes(status)
        // Staff sent it back: the player can always pick a new date, whatever the cutoff.
        // Bookings a captain added this player to show here too, read-only: only the captain changes them.
        const isCaptain = String(reservation.userId || '') === String(user?.id || '')
        const sentBack = isCaptain && Boolean(reservation.sentBack) && status === 'needs review'
        // Players reschedule a booking once (a new date after staff sent it back doesn't count).
        const alreadyRescheduled = playerRescheduleCount(reservation.rescheduleHistory) >= PLAYER_RESCHEDULES_ALLOWED
        const canReschedule = isCaptain && statusAllows && (sentBack || (daysLeft >= RESCHEDULE_CUTOFF_DAYS && !alreadyRescheduled))
        const cutoffDate = date ? addDaysISO(date, -RESCHEDULE_CUTOFF_DAYS) : ''
        const editing = editingId === id
        const reservationPayments = payments.filter((payment) => [reservation.id, reservation._id].map(String).includes(String(payment.reservationId)))
        // A receipt is the player's own: shown once something they paid is verified.
        const myPayments = paymentsOfPayer(reservationPayments as ReceiptPayment[], String(user?.id || ''), reservation)
        const hasVerifiedPayment = myPayments.some(isVerifiedPayment)
        // Unpaid and still waiting for payment: the captain can cancel it.
        const canCancel = ['pending', 'needs review'].includes(status)
          && String(reservation.userId || '') === String(user?.id || '')
          && !reservationPayments.some((payment: any) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
        // A teammate can leave a game that hasn't gone through yet, as long as they haven't paid.
        const canLeave = !isCaptain && ['pending', 'needs review'].includes(status)
          && !myPayments.some((payment: any) => !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
        // Still owes this player's payment and can pay it online now.
        const payable = isCaptain && canPayOnline && status === 'pending' && reservation.paymentState !== 'finalized'
          && !reservationPayments.some((payment: any) => String(payment.userId) === String(user?.id) && !['failed', 'rejected'].includes(String(payment.paymentStatus || '').toLowerCase()))
        // Money: this player's part, what they paid, and what's left; the team's progress.
        const split = String(reservation.paymentMode || 'self').toLowerCase() === 'split'
        const splitItem = splitById.get(String(reservation.id || ''))
        const activePayment = (payment: any) => !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase())
        const myPaid = round2(myPayments.filter(activePayment).reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
        const onlineTarget = Number(reservation.depositAmount) || 0
        const recordedShare = Number(reservation.splitShares?.[me])
        const myShare = split
          ? (Number.isFinite(recordedShare) ? recordedShare : splitItem?.players?.find((p) => p.isMe)?.share ?? round2(onlineTarget / Math.max(1, Number(reservation.teamSize) || 1)))
          : (isCaptain ? onlineTarget : 0)
        // Teammates' spots the captain paid for online (a teammate who left): part of what they pay.
        const coveredSpots = split && isCaptain
          ? (reservation.openSlots || []).filter((slot) => (['covering', 'paid'].includes(String(slot.status || '')) || slot.captainPaid) && Number(slot.amount) > 0)
          : []
        const coveredTotal = round2(coveredSpots.reduce((sum, slot) => sum + Number(slot.amount || 0), 0))
        const open = !rejectedAs && ['pending', 'needs review'].includes(status)
        const myLeft = open
          ? (splitItem ? (splitItem.iHavePaid ? 0 : splitItem.myShareDue) : Math.max(0, round2((myShare || 0) - myPaid)))
          : 0
        const teamIn = round2(splitItem?.progress.submitted ?? Number(reservation.paymentSubmittedAmount || 0))
        const teamPercent = onlineTarget > 0 ? Math.min(100, Math.round((teamIn / onlineTarget) * 100)) : 0
        const waitingOn = splitItem ? Math.max(0, (splitItem.progress.payerCount || 0) - (splitItem.progress.paidCount || 0)) : 0
        const atField = Math.max(0, round2(Number(reservation.totalAmount || 0) - onlineTarget))
        const deadline = reservation.paymentDueAtISO
        const urgent = Boolean(deadline) && new Date(deadline as string).getTime() - Date.now() < 3 * 3600_000
        const canPayNow = open && status === 'pending' && canPayOnline && myLeft > 0
        const ongoingNow = isOngoing(reservation)
        const played = isPlayed(reservation) || (Boolean(date) && date < today && status === 'confirmed')

        // Where it is, in plain words.
        const stage: Stage = rejectedAs
          ? { label: rejectedAs, tone: 'bg-danger/15 text-danger', done: 0 }
          : played ? { label: 'Played', tone: 'bg-success/15 text-success', done: 4 }
            : ongoingNow ? { label: 'Game in progress', tone: 'bg-success/15 text-success', done: 3 }
              : status === 'confirmed' ? { label: 'Confirmed', tone: 'bg-success/15 text-success', done: 3 }
                : sentBack ? { label: 'Action needed', tone: 'bg-danger/15 text-danger', done: 1 }
                  : status === 'needs review' ? { label: 'Being reviewed', tone: 'bg-accent/15 text-accent', done: 2 }
                    : onlineTarget > 0 && teamIn >= onlineTarget - 0.01 ? { label: 'Paid · confirming', tone: 'bg-accent/15 text-accent', done: 2 }
                      : teamIn > 0 ? { label: split ? 'Collecting payments' : 'Payment in review', tone: 'bg-accent/15 text-accent', done: 1 }
                        : { label: 'Waiting for payment', tone: 'bg-accent/15 text-accent', done: 1 }
        // Free spots the captain can put a player in (a teammate declined, lapsed or was removed),
        // until the game starts.
        const freeSpots = isCaptain && !rejectedAs && ['pending', 'needs review', 'confirmed'].includes(status) && !ongoingNow && !played
          ? (reservation.openSlots || []).filter((slot) => ['open', 'covering', 'paid'].includes(String(slot.status || ''))).length
          : 0
        const needsAction = sentBack || canPayNow
        const slotName = slotOf(reservation)
        const slotRange = slotName ? formatSlotRange(slotHours, slotName) : ''
        const label = `${reservation.reservationDate || ''} (${reservation.reservationTime || ''})`

        return (
          <div key={id} id={`booking-${id}`} className="scroll-mt-4"><Card className={`p-4 md:p-5 ${needsAction ? 'border-accent/50 ring-1 ring-accent/20' : ''}`}>
            {/* When and where */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-lg font-bold leading-tight">
                  {date ? formatCardDate(date) : 'No date'} · <span className="capitalize">{slotName || '-'}</span>
                  {slotRange ? <span className="ml-2 text-sm font-normal text-muted">{slotRange}</span> : null}
                </div>
                <div className="mt-1 text-sm text-muted">
                  {reservation.locationName || reservation.locationId || 'Location'} · <span className="capitalize">{reservation.sessionType || 'public'}</span> · {reservation.numberOfPlayers || 0} player{Number(reservation.numberOfPlayers) === 1 ? '' : 's'} · {reservation.packageName || 'Custom selection'}
                </div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[rgba(var(--text),0.06)] px-2.5 py-0.5 text-xs font-semibold">
                  {isCaptain ? 'You booked this' : <>Teammate · booked by <span className="text-accent">{reservation.bookerName || 'your captain'}</span></>}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${stage.tone}`}>{stage.label}</span>
            </div>

            {!rejectedAs ? <BookingSteps done={stage.done} live={ongoingNow} /> : null}

            {/* Money: what this player pays, what's in, what's left */}
            {!rejectedAs && (myShare > 0 || isCaptain) && (open || status === 'confirmed') ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Booking total" value={formatPHP(reservation.totalAmount)} />
                  {split
                    ? (coveredTotal > 0
                      ? <Stat label={`Your share + ${coveredSpots.length} spot${coveredSpots.length === 1 ? '' : 's'}`} value={formatPHP(round2(myShare + coveredTotal))} />
                      : <Stat label="Your share" value={formatPHP(myShare)} />)
                    : <Stat label="Pay online" value={formatPHP(onlineTarget)} />}
                  <Stat label="You paid" value={formatPHP(myPaid)} tone={myPaid > 0 ? 'text-success' : 'text-muted'} />
                  {open
                    ? <Stat label="Left to pay" value={myLeft > 0 ? formatPHP(myLeft) : <span className="inline-flex items-center gap-1 text-success"><FiCheckCircle /> Done</span>} tone={myLeft > 0 ? 'text-gold' : ''} />
                    : <Stat label="At the field" value={atField > 0 ? formatPHP(atField) : 'Nothing'} tone={atField > 0 && isCaptain ? 'text-gold' : 'text-muted'} />}
                </div>
                {isCaptain && Number(reservation.captainOnsiteAmount) > 0 ? (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-[rgba(var(--text),0.05)] px-2.5 py-2 text-xs">
                    <FiInfo className="mt-0.5 shrink-0 text-accent" />
                    <span>
                      <b>{formatPHP(reservation.captainOnsiteAmount)}</b> for teammates who left is paid <b>at the counter before the game</b>
                      {(reservation.openSlots || []).some((slot) => slot.status === 'open') ? ' (less, if a substitute joins and pays online).' : '.'}
                    </span>
                  </div>
                ) : null}
                {split && open && onlineTarget > 0 ? (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5"><FiUsers /> Team: <b className="text-text">{formatPHP(teamIn)}</b> of {formatPHP(onlineTarget)} paid</span>
                      {splitItem ? <span>{splitItem.progress.paidCount || 0} of {splitItem.progress.payerCount || 0} players fully paid</span> : null}
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[rgba(var(--text),0.1)]">
                      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${teamPercent}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* The one thing to do next */}
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
            ) : canPayNow ? (
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <div className="font-semibold">
                    {myPaid > 0 ? `Pay the remaining ${formatPHP(myLeft)}` : split ? `Pay your share of ${formatPHP(myLeft)}` : `Pay ${formatPHP(myLeft)} to lock in your slot`}
                  </div>
                  {deadline ? (
                    <div className={`mt-0.5 flex items-center gap-1 ${urgent ? 'font-semibold text-danger' : 'text-muted'}`}>
                      <FiClock className="shrink-0" /> By {formatDeadline(deadline)} ({timeLeftLabel(deadline)}), or {split && !isCaptain ? 'your spot is released' : 'the slot is released'}.
                    </div>
                  ) : null}
                  {myPaid > 0 && split ? <div className="mt-0.5 text-xs text-muted">Your share went up after you paid; this is the difference.</div> : null}
                </div>
                <Button variant="primary" disabled={payingId === id} onClick={() => payOnline(id)}>
                  <FiCreditCard /> {payingId === id ? 'Opening payment…' : `Pay ${formatPHP(myLeft)}`}
                </Button>
              </div>
            ) : open && split && myLeft <= 0 && waitingOn > 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                <FiCheckCircle className="shrink-0 text-success" />
                <span>
                  Your share is in. Waiting on <b>{waitingOn}</b> teammate{waitingOn === 1 ? '' : 's'} to pay
                  {deadline ? <> · <span className={urgent ? 'font-semibold text-danger' : 'text-muted'}>{timeLeftLabel(deadline)}</span></> : null}.
                </span>
              </div>
            ) : open && !split && !isCaptain ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                <FiInfo className="shrink-0 text-accent" />
                <span>{reservation.bookerName || 'Your captain'} is paying for this game. Nothing for you to pay.</span>
              </div>
            ) : open && stage.done === 2 ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                <FiClock className="shrink-0 text-accent" />
                <span>Everything is paid. Staff are confirming your booking; you'll be notified.</span>
              </div>
            ) : status === 'confirmed' && !ongoingNow && !played ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 p-3 text-sm">
                <FiCheckCircle className="shrink-0 text-success" />
                <span>
                  You're all set{daysLeft === 0 ? ' for today' : daysLeft === 1 ? ' for tomorrow' : ''}.
                  {isCaptain && atField > 0 ? <> Pay the remaining <b>{formatPHP(atField)}</b> at the counter before the game.</> : null}
                </span>
              </div>
            ) : ongoingNow ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 p-3 text-sm">
                <FiCheckCircle className="shrink-0 text-success" /> <span>Your game is under way. Have fun and play safe!</span>
              </div>
            ) : null}

            {/* Everything else you can do */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {freeSpots > 0 ? (
                <Button size="sm" variant="primary" onClick={() => window.dispatchEvent(new CustomEvent(FILL_SPOT_EVENT, { detail: String(reservation.id || '') }))}>
                  <FiUserPlus /> Add player{freeSpots > 1 ? ` (${freeSpots} free spots)` : ' (1 free spot)'}
                </Button>
              ) : null}
              {/* One view of the booking: details, who pays what, charges and payments. */}
              <Button size="sm" variant="ghost" onClick={() => setDetailsId(id)}>
                <FiEye /> View
              </Button>
              {canReschedule && !sentBack && !editing ? (
                <Button size="sm" variant="ghost" onClick={() => startEditing(reservation)}>
                  <FiRefreshCw /> Reschedule
                </Button>
              ) : null}
              {hasVerifiedPayment ? (
                <Button size="sm" variant="ghost" onClick={() => setReceipt({ reservation, payments: myPayments })}>
                  <FiFileText /> Receipt
                </Button>
              ) : null}
              {canCancel ? (
                <Button size="sm" variant="danger-soft" disabled={cancellingId === id} onClick={() => cancelReservation(id, label)}>
                  <FiXCircle /> {cancellingId === id ? 'Cancelling…' : 'Cancel'}
                </Button>
              ) : null}
              {canLeave ? (
                <Button size="sm" variant="danger-soft" disabled={cancellingId === id} onClick={() => leaveGame(id, label, reservation.bookerName || 'the captain')}>
                  <FiXCircle /> {cancellingId === id ? 'Leaving…' : 'Leave game'}
                </Button>
              ) : null}
              <ReservationIdTag id={id} className="ml-auto text-[11px] text-muted" />
            </div>

            {/* Why something isn't possible */}
            {isCaptain && open && !canCancel ? (
              <div className="mt-2 text-xs text-muted">Can't cancel: a payment was already made on this booking. Contact staff if you need to cancel.</div>
            ) : null}
            {tab !== 'archive' && statusAllows && !sentBack && alreadyRescheduled && daysLeft >= 0 ? (
              <div className="mt-1 text-xs text-muted">This booking was already rescheduled once, so it can't be moved again.</div>
            ) : tab !== 'archive' && statusAllows && !sentBack && daysLeft >= 0 && daysLeft < RESCHEDULE_CUTOFF_DAYS ? (
              <div className="mt-1 text-xs text-muted">Rescheduling closed on {formatShortDate(cutoffDate)} ({RESCHEDULE_CUTOFF_DAYS} days before the game).</div>
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
                      setDateError('')
                    }}
                  />
                  <FieldError>{dateError}</FieldError>
                </div>
                {/* One-click reschedule: just pick the new date and slot. A booking staff sent back
                    can carry an optional note for them. */}
                {sentBack ? (
                  <label className="block text-xs font-semibold text-muted md:col-span-3">
                    Note for staff (optional)
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value.slice(0, 500))}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text"
                    />
                  </label>
                ) : null}
                <div className="flex gap-2 md:col-span-3">
                  <Button variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
                  <Button variant="primary" onClick={() => submitReschedule(reservation)} disabled={saving || !newDate}>
                    {saving ? 'Saving…' : 'Confirm new schedule'}
                  </Button>
                </div>
              </div>
            ) : null}

          </Card></div>
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
            // A teammate sees this booking too; the captain is whoever booked it, not the viewer.
            captainName={String(reservation.userId || '') === String(user?.id || '')
              ? (user?.name || 'You')
              : (reservation.bookerName || 'Your captain')}
            slotHours={slotHours}
            onClose={() => setDetailsId(null)}
            ownPayments
            // A team payment: who plays and pays what, right in the same view.
            teamSection={(() => {
              const team = splitById.get(String(reservation.id || '')) || (viewedTeam && String(viewedTeam.reservation.id) === String(reservation.id) ? viewedTeam : null)
              return team ? (
                <TeamPaymentTable
                  item={team}
                  onChanged={() => {
                    void reloadSplit()
                    void load(true)
                    void loadViewedTeam(detailsId)
                  }}
                />
              ) : undefined
            })()}
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
