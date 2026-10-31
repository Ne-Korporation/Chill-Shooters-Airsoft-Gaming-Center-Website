import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FiAlertTriangle, FiCheck, FiClock, FiCornerUpLeft, FiEye, FiImage, FiPrinter, FiRefreshCw, FiTrash2, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { FilterTabs, titleCaseLabel } from '../ui/FilterTabs'
import { apiDelete, apiGet, apiPut } from '../../utils/apiClient'
import { formatPhPhone } from '../../utils/phone'
import { GuardianApprovalBadge, type GuardianApprovalSummary } from '../reservations/GuardianApprovalBadge'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type ReviewStatus = 'pending' | 'needs review' | 'confirmed'

type ReservationDoc = {
  _id?: any
  id?: string
  reservationStatus?: string
  userId?: string
  userName?: string
  player?: string
  reservationDate?: string
  reservationTime?: string
  fieldId?: string
  fieldNames?: string
  locationName?: string
  slot?: string
  selectedPackageId?: string
  selectedGameplayName?: string
  packageName?: string
  mode?: string
  gameMode?: string
  sessionType?: string
  numberOfPlayers?: number
  totalAmount?: number
  depositAmount?: number
  notes?: string
  createdAtISO?: string
  updatedAtISO?: string
  guardianApproval?: GuardianApprovalSummary | null
  sentBack?: { note: string; atISO: string } | null
}

type PaymentDoc = {
  _id?: any
  id?: string
  reservationId?: string
  userId?: string
  paymentMethod?: string
  paymentStatus?: string
  gcashImageUrl?: string
  transactionReference?: string
  senderNumber?: string
  amount?: number
  refNo?: string
  createdAtISO?: string
}

type UserAccountDoc = { _id?: any; id?: string; name?: string; email?: string }

type ReservationView = ReservationDoc & { payments: PaymentDoc[] }

function getId(row: { id?: string; _id?: any }) {
  if (row.id) return String(row.id)
  if (row._id) return String(row._id)
  return null
}

function normalizeStatus(value: unknown): ReviewStatus | string {
  const lower = String(value || '').trim().toLowerCase()
  if (!lower || lower === 'pending') return 'pending'
  if (lower === 'needs review' || lower === 'needs_review' || lower === 'review') return 'needs review'
  if (lower === 'confirmed' || lower === 'approved') return 'confirmed'
  return lower
}

const pill = (status: string) => {
  const lower = status.toLowerCase()
  if (['confirmed', 'paid', 'verified', 'approved'].includes(lower)) return 'bg-success/20 text-success border-success/30'
  if (['needs review', 'review'].includes(lower)) return 'bg-accent/20 text-accent border-accent/30'
  if (['failed', 'rejected'].includes(lower)) return 'bg-danger/20 text-danger border-danger/30'
  return 'bg-white/5 text-text border-white/10'
}

const StatusPill = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${pill(status)}`}>
    {(status || 'pending').toUpperCase()}
  </span>
)

const peso = (value?: number) => (value || value === 0 ? `₱${Number(value).toLocaleString()}` : '—')

function printWindow(title: string, body: string) {
  const win = window.open('', '_blank', 'width=980,height=900')
  if (!win) throw new Error('Popup blocked. Please allow popups to print.')
  win.document.open()
  win.document.write(`<!doctype html><html><head><title>${title}</title><style>
    html, body { margin: 0; font-family: Arial, sans-serif; color: #111; }
    .page { padding: 24px; } h1 { margin: 0 0 8px; font-size: 22px; } .muted { color: #555; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { border-top: 1px solid #ddd; padding: 8px 0; vertical-align: top; } td.key { width: 32%; color: #555; font-size: 12px; }
    img { max-width: 100%; margin-top: 16px; border-radius: 8px; }
  </style></head><body><div class="page">${body}</div></body></html>`)
  win.document.close()
  return win
}

// The booking payment review queue: every reservation by status (Pending, Needs review, Confirmed),
// with a review window to check the payment proofs and decide the booking. Shared by the admin and
// registrar Payments pages; only admins can delete.
export function BookingPaymentReview() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { addNotification } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ReviewStatus>('pending')
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [payments, setPayments] = useState<PaymentDoc[]>([])
  const [users, setUsers] = useState<UserAccountDoc[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sendBackNote, setSendBackNote] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [reservationRes, paymentRes, usersRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200'),
        apiGet<{ ok: boolean; data: UserAccountDoc[] }>('/api/user_accounts?limit=200'),
      ])
      setReservations(Array.isArray(reservationRes?.data) ? reservationRes.data : [])
      setPayments(Array.isArray(paymentRes?.data) ? paymentRes.data : [])
      setUsers(Array.isArray(usersRes?.data) ? usersRes.data : [])
    } catch (e: any) {
      const message = String(e?.message || e)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const rows = useMemo<ReservationView[]>(() => reservations.map((reservation) => {
    const ids = [reservation.id, reservation._id].filter(Boolean).map(String)
    return { ...reservation, payments: payments.filter((payment) => ids.includes(String(payment.reservationId))) }
  }), [payments, reservations])

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of users) {
      const key = String(account.id || account._id || '')
      if (key) map.set(key, String(account.name || account.email || key))
    }
    return map
  }, [users])
  const customerOf = (reservation: ReservationDoc) =>
    nameById.get(String(reservation.userId || '')) || reservation.userName || reservation.player || reservation.userId || '—'

  const counts = useMemo(() => {
    const next: Record<ReviewStatus, number> = { pending: 0, 'needs review': 0, confirmed: 0 }
    for (const row of rows) {
      const status = normalizeStatus(row.reservationStatus)
      if (status in next) next[status as ReviewStatus] += 1
    }
    return next
  }, [rows])

  const visible = rows.filter((row) => normalizeStatus(row.reservationStatus) === active)
  const selected = selectedId ? rows.find((row) => getId(row) === selectedId) ?? null : null
  const proofs = selected?.payments.filter((payment) => payment.gcashImageUrl) ?? []

  const close = () => {
    setSelectedId(null)
    setSendBackNote('')
  }

  const updateStatus = async (nextStatus: ReviewStatus, note = '') => {
    if (!selected) return
    const reservationId = getId(selected)
    if (!reservationId) return toast.error('Reservation id missing')
    setSaving(true)
    try {
      await apiPut(`/api/reservations/${encodeURIComponent(reservationId)}/status`, {
        reservationStatus: nextStatus,
        ...(note ? { sendBack: true, note } : {}),
      })
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'reservation_status_update',
        title: 'Reservation Update Received',
        message: note ? `Reservation ${reservationId} was sent back to the player.` : `Reservation ${reservationId} was moved to ${nextStatus}.`,
        linkedResourceId: reservationId,
      })
      if (nextStatus === 'confirmed' && selected.userId) {
        addNotification({
          userId: selected.userId,
          type: 'reservation_confirmed',
          title: 'Reservation Confirmed',
          message: `Your reservation ${reservationId} has been confirmed. Payment has been verified.`,
          linkedResourceId: reservationId,
        })
      }
      toast.success(note ? 'Reservation sent back to the player' : `Reservation marked as ${nextStatus}`)
      setActive(nextStatus)
      close()
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const sendBack = () => {
    const note = sendBackNote.trim()
    if (!note) return toast.error('Write a short note so the player knows what to fix.')
    void updateStatus('needs review', note)
  }

  const deleteReservation = async () => {
    if (!selected) return
    const reservationId = getId(selected)
    if (!reservationId) return
    if (!window.confirm(`Cancel reservation ${reservationId}?\n\nPayment and gameplay history is kept. This cannot be undone.`)) return
    try {
      await apiDelete(`/api/reservations/${encodeURIComponent(reservationId)}`)
      toast.success('Reservation cancelled')
      close()
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const printDetails = () => {
    if (!selected) return
    const rowsHtml = [
      ['Reservation ID', getId(selected) || '—'],
      ['Status', normalizeStatus(selected.reservationStatus)],
      ['Customer', customerOf(selected)],
      ['Date', `${selected.reservationDate || '—'} • ${selected.reservationTime || selected.slot || '—'}`],
      ['Location', selected.locationName || '—'],
      ['Players', selected.numberOfPlayers ?? '—'],
      ['Total', peso(selected.totalAmount)],
      ...selected.payments.map((payment, index) => [
        `Payment ${index + 1}`,
        `${payment.paymentMethod || '—'} • ${peso(payment.amount)} • ${payment.paymentStatus || 'pending'} • Ref ${payment.transactionReference || payment.refNo || '—'}`,
      ]),
    ].map(([key, value]) => `<tr><td class="key">${key}</td><td>${value}</td></tr>`).join('')
    try {
      const win = printWindow(`Reservation ${getId(selected)}`, `<h1>Booking payment review</h1><table>${rowsHtml}</table>`)
      setTimeout(() => win.print(), 350)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the print window')
    }
  }

  const printProof = (url: string) => {
    try {
      printWindow('Payment proof', `<h1>Payment proof</h1><img src="${url}" alt="Payment proof" onload="window.focus();window.print();" />`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the print window')
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Booking payment review</div>
          <div className="mt-1 text-sm text-muted">Check each booking's payment proof, then confirm it, flag it, or send it back to the player.</div>
        </div>
        <FilterTabs
          ariaLabel="Filter bookings by status"
          value={active}
          onChange={setActive}
          options={(['pending', 'needs review', 'confirmed'] as const).map((status) => ({ value: status, label: titleCaseLabel(status), count: counts[status] }))}
        />
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger">
          <FiAlertTriangle className="mr-2 inline-block" /> {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
        <div className="hidden bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted sm:grid sm:grid-cols-12">
          <div className="sm:col-span-2">ID</div>
          <div className="sm:col-span-3">Customer</div>
          <div className="sm:col-span-3">Schedule</div>
          <div className="sm:col-span-2">Payment</div>
          <div className="sm:col-span-2 text-right">Actions</div>
        </div>
        <div className="divide-y divide-white/5">
          {loading ? (
            <div className="p-6 text-sm text-muted">Loading bookings…</div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-sm text-muted">No bookings with this status.</div>
          ) : visible.map((row) => {
            const id = getId(row)
            return (
              <div key={id ?? row.createdAtISO} className="flex flex-col gap-2 px-3 py-3 sm:grid sm:grid-cols-12 sm:items-center">
                <div className="text-sm font-semibold sm:col-span-2">{id ?? '—'}</div>
                <div className="text-sm text-muted sm:col-span-3">
                  {customerOf(row)}
                  {row.sentBack ? <div className="text-xs text-danger">Sent back: waiting for the player</div> : null}
                </div>
                <div className="text-sm text-muted sm:col-span-3">
                  <div>{[row.reservationDate, row.reservationTime].filter(Boolean).join(' • ') || '—'}</div>
                  <div className="text-xs text-muted/70">{row.locationName || ''}</div>
                </div>
                <div className="text-xs text-muted sm:col-span-2">
                  {row.payments.length
                    ? `${row.payments.length} payment${row.payments.length === 1 ? '' : 's'} • ${peso(row.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0))}`
                    : 'No payment yet'}
                </div>
                <div className="sm:col-span-2 sm:text-right">
                  <Button size="xs" variant="ghost" onClick={() => setSelectedId(id)}>
                    <FiEye /> Review
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <FiRefreshCw /> Refresh
        </Button>
      </div>

      {selected && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-background shadow-soft">
            <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4 md:p-5">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Booking payment review</div>
                <h2 className="mt-1 text-2xl font-bold">{getId(selected)}</h2>
                <p className="mt-1 text-sm text-muted">{customerOf(selected)} • {selected.reservationDate} {selected.reservationTime}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={close} aria-label="Close" className="w-10 px-0"><FiX /></Button>
            </div>

            <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
              <div className="max-h-[calc(92vh-120px)] space-y-4 overflow-y-auto p-4 md:p-5">
                <Card className="p-4">
                  <div className="text-xs uppercase tracking-widest text-muted">Payments ({selected.payments.length})</div>
                  <div className="mt-2 text-sm">Total {peso(selected.totalAmount)} • Deposit {peso(selected.depositAmount)}</div>
                  {selected.payments.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-muted">No payment submitted yet.</div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {selected.payments.map((payment) => (
                        <div key={getId(payment) || payment.createdAtISO} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold">{payment.paymentMethod || '—'} • {peso(payment.amount)}</div>
                            <StatusPill status={String(payment.paymentStatus || 'pending')} />
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            Paid by {nameById.get(String(payment.userId || '')) || payment.userId || '—'} • Ref {payment.transactionReference || payment.refNo || '—'}
                            {payment.senderNumber ? ` • From ${formatPhPhone(payment.senderNumber)}` : ''}
                          </div>
                          {payment.gcashImageUrl ? (
                            <div className="mt-2">
                              <img src={payment.gcashImageUrl} alt="Payment proof" className="max-h-[280px] w-full rounded-xl border border-white/10 bg-black/20 object-contain" />
                              <Button size="xs" variant="ghost" className="mt-2" onClick={() => printProof(payment.gcashImageUrl!)}>
                                <FiImage /> Print proof
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-xs text-muted">Approve or send back individual payments in the list below this queue.</div>
                </Card>

                <Card className="p-4">
                  <div className="text-xs uppercase tracking-widest text-muted">Booking</div>
                  <div className="mt-3 space-y-2 text-sm">
                    {[
                      ['Location', selected.locationName || '—'],
                      ['Field', selected.fieldNames || selected.fieldId || '—'],
                      ['Session', selected.sessionType || '—'],
                      ['Game mode', selected.mode || selected.gameMode || '—'],
                      ['Package', selected.packageName || selected.selectedGameplayName || '—'],
                      ['Players', String(selected.numberOfPlayers ?? '—')],
                      ['Notes', selected.notes || '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0">
                        <div className="text-muted">{label}</div>
                        <div className="text-right font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="space-y-4 border-t border-white/5 p-4 md:p-5 lg:border-l lg:border-t-0">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted">Status</div>
                  <div className="mt-2"><StatusPill status={String(normalizeStatus(selected.reservationStatus))} /></div>
                  <GuardianApprovalBadge
                    reservationId={String(selected.id || selected._id || '')}
                    summary={selected.guardianApproval}
                    canRecordInPerson
                    onChanged={() => void refresh()}
                  />
                </div>

                <div className="grid gap-2">
                  <Button className="w-full" variant="primary" disabled={saving} onClick={() => updateStatus('confirmed')}>
                    <FiCheck /> Confirm booking
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => updateStatus('pending')}><FiClock /> Mark pending</Button>
                    <Button size="sm" variant="accent-soft" disabled={saving} onClick={() => updateStatus('needs review')}><FiEye /> Needs review</Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3">
                  <div className="text-sm font-semibold">Send back to player</div>
                  <div className="mt-1 text-xs text-muted">For an invalid booking. The player sees your note in My Reservations and can choose a new date; their deposit carries over.</div>
                  {selected.sentBack ? (
                    <div className="mt-2 text-xs text-danger">Already sent back: "{selected.sentBack.note}"</div>
                  ) : null}
                  <textarea
                    value={sendBackNote}
                    onChange={(e) => setSendBackNote(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="e.g., The field is closed for maintenance that day. Please choose another date."
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text"
                  />
                  <Button size="sm" variant="danger-soft" className="mt-2 w-full" disabled={saving || !sendBackNote.trim()} onClick={sendBack}>
                    <FiCornerUpLeft /> Send back with note
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="ghost" onClick={printDetails}><FiPrinter /> Print details</Button>
                  <Button size="sm" variant="ghost" disabled={proofs.length === 0} onClick={() => proofs[0]?.gcashImageUrl && printProof(proofs[0].gcashImageUrl)}>
                    <FiImage /> Print proof
                  </Button>
                </div>

                {isAdmin ? (
                  <div className="border-t border-white/5 pt-4">
                    <Button size="sm" variant="danger-soft" className="w-full" onClick={deleteReservation}>
                      <FiTrash2 /> Cancel reservation
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </Card>
  )
}
