import React, { useEffect, useMemo, useState } from 'react'
import { promptDialog } from '../../components/ui/ConfirmDialog'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { FiCheck, FiCornerUpLeft, FiDollarSign, FiFileText, FiFlag } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Card } from '../../components/ui/Card'
import toast from 'react-hot-toast'
import { apiGetAll, apiPut } from '../../utils/apiClient'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'
import { ReceiptModal } from '../../components/payments/ReceiptModal'
import { ReservationIdTag } from '../../components/reservations/ReservationIdTag'
import type { ReceiptPayment, ReceiptReservation } from '../../utils/receiptPrint'


type PaymentStatus = 'paid' | 'pending' | 'failed' | 'review' | 'confirmed' | 'cancelled'

type PaymentItem = {
  reservationId: string
  reviewedBy: string
  id: string
  player: string
  amount: number
  method: string
  status: PaymentStatus
  date: string
  note: string
  receiptUrl: string
  stripe: boolean
  // Set for payments verified by the online gateway (Xendit, or PayMongo before it); reviewReason explains one held for staff.
  gatewayName: string
  reviewReason: string
  // The stored payment, for its receipt.
  raw: ReceiptPayment & { reservationId?: string }
}

const KNOWN_STATUSES: PaymentStatus[] = ['paid', 'pending', 'failed', 'review', 'confirmed', 'cancelled']
const VERIFIED: PaymentStatus[] = ['paid', 'confirmed']

// Tabs: every payment, bookings with money still to collect, then the payment statuses that need
// (or needed) a person. "Needs review" holds what the gateway flagged and older proof uploads.
type Tab = 'all' | 'balance' | 'review' | 'failed' | 'cancelled'

// A booking that isn't fully paid yet: the 50% downpayment with the rest due at the field, or a
// team still paying its shares online.
type BalanceRow = {
  reservationId: string
  booker: string
  dateISO: string
  slot: string
  location: string
  players: number
  total: number
  paid: number
  due: number
  stage: string
  split: boolean
  overdue: boolean
}

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

function formatWhen(iso: string) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso || '—'
  return new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatGameDate(dateISO: string) {
  const time = Date.parse(`${dateISO}T12:00:00+08:00`)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) : dateISO
}

const manilaToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

function normalizePaymentStatus(value: unknown): PaymentStatus {
  const lower = String(value || 'pending').toLowerCase()
  if (lower === 'rejected') return 'failed'
  if (lower === 'submitted') return 'pending'
  return (KNOWN_STATUSES as string[]).includes(lower) ? (lower as PaymentStatus) : 'pending'
}

const statusBadge = (status: PaymentStatus) => {
  switch (status) {
    case 'paid':
      return 'bg-success/20 text-success border-success/30'
    case 'confirmed':
      return 'bg-success/20 text-success border-success/30'
    case 'pending':
      return 'bg-accent/20 text-accent border-accent/30'
    case 'failed':
      return 'bg-danger/20 text-danger border-danger/30'
    case 'review':
      return 'bg-white/5 text-text border-white/5'
    case 'cancelled':
      return 'bg-white/5 text-muted border-white/10 line-through'
  }
}

const StatusPill = ({ status }: { status: PaymentStatus }) => {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusBadge(status)}`}>
      {status === 'failed' ? 'Sent back' : titleCaseLabel(status)}
    </span>
  )
}

export function AdminPaymentsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [active, setActive] = React.useState<Tab>('all')
  const [payments, setPayments] = React.useState<PaymentItem[]>([])
  const [reservations, setReservations] = useState<any[]>([])
  const [nameOf, setNameOf] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const { addNotification } = useNotifications()
  // Reservations by id (and Mongo _id), for each payment's receipt.
  const [reservationById, setReservationById] = useState<Map<string, ReceiptReservation>>(new Map())
  const [receipt, setReceipt] = useState<{ payment: PaymentItem; reservation: ReceiptReservation | null; reservationPayments: ReceiptPayment[] } | null>(null)

  const openReceipt = (payment: PaymentItem) => {
    const reservation = reservationById.get(payment.reservationId) || null
    const ids = reservation ? [reservation.id, reservation._id].filter(Boolean).map(String) : [payment.reservationId]
    setReceipt({
      payment,
      reservation,
      reservationPayments: payments.filter((p) => ids.includes(p.reservationId)).map((p) => p.raw),
    })
  }

  // `silent`: a background refresh, without the loading state or error pop-ups.
  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [docs, reservations, accounts] = await Promise.all([
        apiGetAll<any>('payments'),
        apiGetAll<any>('reservations'),
        apiGetAll<any>('user_accounts'),
      ])
      // Older records were never updated when their booking was cancelled: treat any unverified
      // payment on a cancelled booking as cancelled so it leaves "Needs review" and "Pending amount".
      const cancelledReservations = new Set(reservations
        .filter((r: any) => String(r.reservationStatus || '').toLowerCase() === 'cancelled')
        .flatMap((r: any) => [r.id, r._id].filter(Boolean).map(String)))
      setReservationById(new Map(reservations.flatMap((r: any) => [r.id, r._id].filter(Boolean).map((key: any) => [String(key), r] as [string, ReceiptReservation]))))
      setReservations(reservations)
      const nameById = new Map<string, string>(accounts.map((a: any) => [String(a.id || a._id || ''), String(a.name || a.email || '')]))
      setNameOf(nameById)
      setPayments(
        docs.map((d: any) => {
          const status = normalizePaymentStatus(d.paymentStatus ?? d.status)
          const reservationId = String(d.reservationId || '')
          return {
          id: d.id ?? (d._id ? String(d._id) : ''),
          reservationId,
          player: (d.userId && nameById.get(String(d.userId))) || (d.userId ? String(d.userId) : d.player ?? '—'),
          amount: Number(d.amount ?? d.totalPHP ?? 0),
          method: d.paymentMethod ?? d.method ?? '—',
          status: ['pending', 'review'].includes(status) && cancelledReservations.has(reservationId) ? 'cancelled' as const : status,
          reviewedBy: d.verifiedByRole && !['system', 'user'].includes(d.verifiedByRole)
            ? `${titleCaseLabel(String(d.verifiedByRole))}${d.verifiedByName ? ` ${d.verifiedByName}` : ''}`
            : '',
          date: d.createdAtISO ?? d.createdAt ?? d.submittedAtISO ?? '—',
          note: d.transactionReference ?? d.refNo ?? d.note ?? '',
          receiptUrl: d.gcashImageUrl ?? d.proofUrl ?? d.receiptUrl ?? '',
          stripe: Boolean(d.stripePaymentIntentId),
          gatewayName: d.xenditInvoiceId ? 'Xendit' : d.paymongoCheckoutId ? 'PayMongo' : '',
          reviewReason: d.reviewReason ?? '',
          raw: { ...d, id: d.id ?? (d._id ? String(d._id) : ''), paymentStatus: ['pending', 'review'].includes(status) && cancelledReservations.has(reservationId) ? 'cancelled' : (d.paymentStatus ?? d.status) },
          }
        }).sort((a, b) => String(b.date).localeCompare(String(a.date)))
      )
    } catch (e: any) {
      // A failed background refresh keeps the list on screen.
      if (silent) return
      toast.error(String(e?.message || e))
      setPayments([])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // New payments and bookings show up without reloading the page.
  useAutoRefresh(() => load(true))

  const needsReview = (payment: PaymentItem) => payment.status === 'pending' || payment.status === 'review'
  const filtered = useMemo(
    () => payments.filter((payment) => (
      active === 'all' ? true
        : active === 'review' ? needsReview(payment)
          : payment.status === active
    )),
    [payments, active],
  )
  const { page, setPage, pageCount, pageItems, total } = usePagination(filtered, undefined, active)
  const reviewCount = payments.filter(needsReview).length
  const todayISO = manilaToday()
  const paidToday = payments.filter((payment) => VERIFIED.includes(payment.status) && new Date(Date.parse(payment.date) + 8 * 3600_000).toISOString().slice(0, 10) === todayISO)
  const collectedToday = paidToday.reduce((sum, p) => sum + p.amount, 0)

  // Bookings with money still to collect: everything active that isn't paid in full (the 50%
  // downpayment plan pays the rest at the field; a team may still be paying its shares online).
  const balances = useMemo<BalanceRow[]>(() => {
    const paidFor = new Map<string, number>()
    for (const payment of payments) {
      if (!VERIFIED.includes(payment.status)) continue
      paidFor.set(payment.reservationId, (paidFor.get(payment.reservationId) || 0) + payment.amount)
    }
    return reservations
      .filter((r) => !r.walkIn && ['confirmed', 'pending', 'needs review'].includes(String(r.reservationStatus || '').toLowerCase()))
      .map((r) => {
        const ids = [r.id, r._id].filter(Boolean).map(String)
        const paid = Math.round(ids.reduce((sum, id) => sum + (paidFor.get(id) || 0), 0) * 100) / 100
        const totalAmount = Number(r.totalAmount || 0)
        const deposit = Number(r.depositAmount || 0)
        const split = String(r.paymentMode || 'self').toLowerCase() === 'split'
        const payerCount = 1 + (Array.isArray(r.splitPayerIds) ? r.splitPayerIds.length : 0)
        const paidPayers = new Set(payments.filter((p) => ids.includes(p.reservationId) && VERIFIED.includes(p.status)).map((p) => String(p.raw?.userId || '')))
        const stage = paid + 0.01 < deposit
          ? (split ? `Waiting for online shares (${paidPayers.size} of ${payerCount} paid)` : 'Waiting for the online payment')
          : r.paymentPlan === 'full' ? 'Additional charges to collect' : '50% downpayment paid · rest at the field'
        const dateISO = String(r.reservationDate || '')
        return {
          reservationId: String(r.id || r._id),
          booker: r.bookerName || nameOf.get(String(r.userId)) || String(r.userId || '—'),
          dateISO,
          slot: String(r.reservationTime || ''),
          location: String(r.locationName || r.locationId || ''),
          players: Number(r.numberOfPlayers || 0),
          total: totalAmount,
          paid,
          due: Math.round(Math.max(0, totalAmount - paid) * 100) / 100,
          stage,
          split,
          overdue: dateISO < todayISO,
        }
      })
      .filter((row) => row.due > 0.01)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.slot.localeCompare(b.slot))
  }, [payments, reservations, nameOf, todayISO])
  const balanceTotal = balances.reduce((sum, row) => sum + row.due, 0)
  const balancePages = usePagination(balances, undefined, `balance-${active}`)

  const [updatingId, setUpdatingId] = useState('')

  const updateStatus = async (id: string, nextStatus: PaymentStatus, reason = '') => {
    setUpdatingId(id)
    try {
      await apiPut(`/api/payments/${encodeURIComponent(id)}/verify`, { paymentStatus: nextStatus, reason })
      const by = [titleCaseLabel(String(user?.role || 'staff')), user?.name].filter(Boolean).join(' ')
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar'],
        type: 'payment_verified',
        title: `Payment ${nextStatus === 'paid' ? 'approved' : nextStatus === 'failed' ? 'sent back' : 'updated'} by ${by}`,
        message: `${by} marked payment ${id} as ${nextStatus === 'failed' ? 'sent back' : nextStatus}${reason ? `: ${reason}` : '.'}`,
        linkedResourceId: id,
      })
      await load()
      toast.success(nextStatus === 'paid' ? 'Payment approved' : nextStatus === 'failed' ? 'Payment sent back to the player' : 'Payment updated')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setUpdatingId('')
    }
  }

  const sendBack = async (payment: PaymentItem) => {
    const reason = await promptDialog({
      title: 'Send this payment back?',
      message: 'The player sees this reason and can pay again online.',
      label: 'Reason',
      placeholder: 'e.g. The reference number does not match',
      confirmLabel: 'Send back',
      danger: true,
      required: true,
      multiline: true,
    })
    if (!reason) return
    void updateStatus(payment.id, 'failed', reason)
  }


  const sentBackCount = payments.filter((p) => p.status === 'failed').length
  const cancelledCount = payments.filter((p) => p.status === 'cancelled').length
  const tabs: Array<{ value: Tab; label: string; count: number }> = [
    { value: 'all', label: 'All payments', count: payments.length },
    { value: 'balance', label: 'Pending balance', count: balances.length },
    { value: 'review', label: 'Needs review', count: reviewCount },
    ...(sentBackCount ? [{ value: 'failed' as const, label: 'Sent back', count: sentBackCount }] : []),
    ...(cancelledCount ? [{ value: 'cancelled' as const, label: 'Cancelled', count: cancelledCount }] : []),
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Online payments go through the payment gateway and confirm bookings automatically. Here you track the balances still to
          collect at the field, check anything the gateway flagged, and print receipts.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card className="rounded-xl px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Collected today</div>
          <div className="mt-1 text-xl font-bold text-success">{peso(collectedToday)}</div>
          <div className="text-xs text-muted">{paidToday.length} payment{paidToday.length === 1 ? '' : 's'}</div>
        </Card>
        <button type="button" onClick={() => setActive('balance')} className="text-left">
          <Card className="h-full rounded-xl px-4 py-3 transition hover:border-accent/40">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Balance to collect</div>
            <div className="mt-1 text-xl font-bold text-warning">{peso(balanceTotal)}</div>
            <div className="text-xs text-muted">{balances.length} booking{balances.length === 1 ? '' : 's'} not fully paid</div>
          </Card>
        </button>
        <button type="button" onClick={() => setActive('review')} className="text-left">
          <Card className="h-full rounded-xl px-4 py-3 transition hover:border-accent/40">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Needs review</div>
            <div className={`mt-1 text-xl font-bold ${reviewCount ? 'text-danger' : 'text-text'}`}>{reviewCount}</div>
            <div className="text-xs text-muted">{reviewCount ? 'Flagged by the gateway or a proof upload' : 'Nothing to check'}</div>
          </Card>
        </button>
      </div>

      <Card className="p-4">
        <FilterTabs ariaLabel="Filter payments" value={active} onChange={setActive} options={tabs} />

        {active === 'balance' ? (
          <>
            <p className="mt-3 text-sm text-muted">
              Bookings not paid in full yet, by game date. Most chose the 50% downpayment: the rest is paid at the counter on game day.
            </p>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-white/5">
              <div className="hidden bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted lg:grid lg:grid-cols-12">
                <div className="col-span-3">Booking</div>
                <div className="col-span-3">Game</div>
                <div className="col-span-1 text-right">Total</div>
                <div className="col-span-1 text-right">Paid</div>
                <div className="col-span-2 text-right">Balance due</div>
                <div className="col-span-2 text-right" />
              </div>
              <div className="divide-y divide-white/5">
                {balances.length === 0 ? (
                  <div className="p-6 text-sm text-muted">Every active booking is paid in full.</div>
                ) : balancePages.pageItems.map((row) => (
                  <div key={row.reservationId} className="flex flex-col gap-2 px-3 py-3 lg:grid lg:grid-cols-12 lg:items-center">
                    <div className="min-w-0 lg:col-span-3">
                      <div className="truncate text-sm font-semibold">{row.booker}</div>
                      <ReservationIdTag id={row.reservationId} className="mt-0.5 text-[11px] text-muted" />
                    </div>
                    <div className="min-w-0 lg:col-span-3">
                      <div className={`text-sm font-semibold ${row.dateISO === todayISO ? 'text-accent' : row.overdue ? 'text-danger' : ''}`}>
                        {row.dateISO === todayISO ? 'Today' : formatGameDate(row.dateISO)} · {titleCaseLabel(row.slot)}{row.overdue ? ' (past)' : ''}
                      </div>
                      <div className="truncate text-xs text-muted">{row.location} · {row.players} player{row.players === 1 ? '' : 's'}</div>
                      <div className="mt-0.5 text-xs text-warning">{row.stage}</div>
                    </div>
                    <div className="text-sm lg:col-span-1 lg:text-right"><span className="text-xs text-muted lg:hidden">Total </span>{peso(row.total)}</div>
                    <div className="text-sm text-success lg:col-span-1 lg:text-right"><span className="text-xs text-muted lg:hidden">Paid </span>{peso(row.paid)}</div>
                    <div className="text-base font-bold text-warning lg:col-span-2 lg:text-right"><span className="text-xs font-normal text-muted lg:hidden">Due </span>{peso(row.due)}</div>
                    <div className="lg:col-span-2 lg:text-right">
                      <Button size="xs" variant="accent-soft" onClick={() => navigate(`/app/counter?reservation=${encodeURIComponent(row.reservationId)}`)}>
                        <FiDollarSign /> Collect at counter
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Pagination page={balancePages.page} pageCount={balancePages.pageCount} total={balancePages.total} onPageChange={balancePages.setPage} />
          </>
        ) : (
        <>
        {active === 'review' ? (
          <p className="mt-3 text-sm text-muted">Payments the gateway held for a person (e.g. paid after the booking was cancelled), and older proof uploads.</p>
        ) : null}
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/5">
          <div className="hidden lg:grid lg:grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-3">Payment ID</div>
            <div className="col-span-2">Player</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No payments match the selected filter.</div>
            ) : (
              pageItems.map((payment) => (
                <div key={payment.id} className="flex flex-col gap-3 px-3 py-3 lg:grid lg:grid-cols-12 lg:items-center">
                  <div className="min-w-0 lg:col-span-3">
                    <div className="truncate text-sm font-semibold" title={payment.id}>{payment.id}</div>
                    <div className="mt-1 text-xs text-muted">{formatWhen(payment.date)}</div>
                    {payment.reservationId ? <ReservationIdTag id={payment.reservationId} className="mt-1 text-[11px] text-muted" /> : null}
                  </div>
                  <div className="min-w-0 lg:col-span-2">
                    <div className="truncate text-sm font-semibold">{payment.player}</div>
                    <div className="mt-1 truncate text-xs text-muted">{payment.note}</div>
                    {payment.reviewReason ? <div className="mt-1 text-xs text-warning">{payment.reviewReason}</div> : null}
                  </div>
                  <div className="text-sm font-semibold lg:col-span-1 lg:text-right">{peso(payment.amount)}</div>
                  <div className="lg:col-span-2 lg:text-right">
                    <StatusPill status={payment.status} />
                    <div className="mt-1 text-xs text-muted">{payment.method}</div>
                  </div>
                  <div className="lg:col-span-4">
                    <ActionGroup className="lg:justify-end" align="start">
                      <Button size="xs" variant="ghost" onClick={() => openReceipt(payment)}>
                        <FiFileText /> Receipt
                      </Button>
                      {payment.status === 'paid' || payment.status === 'confirmed' ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs font-semibold text-success">
                          {payment.gatewayName ? `Verified by ${payment.gatewayName}` : payment.reviewedBy ? `Verified by ${payment.reviewedBy}` : 'Verified'}
                        </span>
                      ) : payment.status === 'failed' ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">Sent back{payment.reviewedBy ? ` by ${payment.reviewedBy}` : ''}</span>
                      ) : payment.status === 'cancelled' ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">Reservation cancelled</span>
                      ) : payment.stripe ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">Verified by Stripe</span>
                      ) : (
                        <>
                          <Button size="xs" variant="success-soft" disabled={updatingId === payment.id} onClick={() => updateStatus(payment.id, 'paid')}>
                            <FiCheck /> Approve
                          </Button>
                          {payment.status === 'pending' && (
                            <Button size="xs" variant="accent-soft" disabled={updatingId === payment.id} onClick={() => updateStatus(payment.id, 'review')}>
                              <FiFlag /> Flag for review
                            </Button>
                          )}
                          <Button size="xs" variant="danger-soft" disabled={updatingId === payment.id} onClick={() => sendBack(payment)}>
                            <FiCornerUpLeft /> Send back
                          </Button>
                        </>
                      )}
                    </ActionGroup>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />
        </>
        )}
      </Card>

      {receipt ? (
        <ReceiptModal
          payment={receipt.payment.raw}
          reservation={receipt.reservation}
          reservationPayments={receipt.reservationPayments}
          payerName={receipt.payment.player}
          proofUrl={receipt.payment.receiptUrl}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  )
}

