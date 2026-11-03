import React, { useEffect, useMemo, useState } from 'react'
import { FiCheck, FiCornerUpLeft, FiFileText, FiFlag } from 'react-icons/fi'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Card } from '../../components/ui/Card'
import toast from 'react-hot-toast'
import { apiGetAll, apiPut } from '../../utils/apiClient'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'


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
}

const KNOWN_STATUSES: PaymentStatus[] = ['paid', 'pending', 'failed', 'review', 'confirmed', 'cancelled']

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
      {status.toUpperCase()}
    </span>
  )
}

export function AdminPaymentsPage() {
  const { user } = useAuth()
  const [active, setActive] = React.useState<PaymentStatus | 'all'>('all')
  const [payments, setPayments] = React.useState<PaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const { addNotification } = useNotifications()

  const load = async () => {
    setLoading(true)
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
      const nameById = new Map(accounts.map((a: any) => [String(a.id || a._id || ''), String(a.name || a.email || '')]))
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
          }
        }).sort((a, b) => String(b.date).localeCompare(String(a.date)))
      )
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setPayments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(
    () => payments.filter((payment) => (active === 'all' ? true : payment.status === active)),
    [payments, active],
  )
  const { page, setPage, pageCount, pageItems, total } = usePagination(filtered, undefined, active)
  const reviewCount = payments.filter((payment) => payment.status === 'review').length
  const pendingValue = payments.filter((payment) => payment.status === 'pending').reduce((sum, p) => sum + p.amount, 0)
  const todayLabel = new Date().toDateString()
  const completedToday = payments.filter((payment) => {
    const time = Date.parse(payment.date)
    return (payment.status === 'paid' || payment.status === 'confirmed') && Number.isFinite(time) && new Date(time).toDateString() === todayLabel
  }).length

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

  const sendBack = (payment: PaymentItem) => {
    const reason = window.prompt('Why is this payment being sent back? The player sees this reason and can pay again online.')
    if (reason === null) return
    if (!reason.trim()) {
      toast.error('Enter a reason so the player knows what to fix.')
      return
    }
    void updateStatus(payment.id, 'failed', reason.trim())
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-muted">Payments made through Xendit are checked automatically and their bookings confirmed. Use this page for anything Xendit flagged, older proof uploads, and receipts.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Needs review</div>
          <div className="mt-0.5 text-base font-bold text-accent">{reviewCount}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Pending amount</div>
          <div className="mt-0.5 text-base font-bold text-danger">₱{pendingValue}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Completed today</div>
          <div className="mt-0.5 text-base font-bold text-success">{completedToday}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Verification & receipts</div>
            <div className="mt-2 text-sm text-muted">Approve payments, request corrections, or flag suspicious transactions.</div>
          </div>
          <FilterTabs
            ariaLabel="Filter payments by status"
            value={active}
            onChange={setActive}
            options={(['all', 'pending', 'review', 'paid', 'confirmed', 'failed', 'cancelled'] as const).map((status) => ({
              value: status,
              label: status === 'all' ? 'All' : status === 'failed' ? 'Sent back' : titleCaseLabel(status),
              count: status === 'all' ? payments.length : payments.filter((p) => p.status === status).length,
            }))}
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
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
                  <div className="lg:col-span-3">
                    <div className="text-sm font-semibold">{payment.id}</div>
                    <div className="mt-1 text-xs text-muted">{payment.date}</div>
                  </div>
                  <div className="min-w-0 lg:col-span-2">
                    <div className="truncate text-sm font-semibold">{payment.player}</div>
                    <div className="mt-1 truncate text-xs text-muted">{payment.note}</div>
                    {payment.reviewReason ? <div className="mt-1 text-xs text-warning">{payment.reviewReason}</div> : null}
                  </div>
                  <div className="text-sm font-semibold lg:col-span-1 lg:text-right">₱{payment.amount}</div>
                  <div className="lg:col-span-2 lg:text-right">
                    <StatusPill status={payment.status} />
                    <div className="mt-1 text-xs text-muted">{payment.method}</div>
                  </div>
                  <div className="lg:col-span-4">
                    <ActionGroup className="lg:justify-end" align="start">
                      {payment.receiptUrl ? (
                        <a
                          href={payment.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="surface hover-row inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-text"
                        >
                          <FiFileText /> Receipt
                        </a>
                      ) : (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">No receipt</span>
                      )}
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
      </Card>
    </div>
  )
}

