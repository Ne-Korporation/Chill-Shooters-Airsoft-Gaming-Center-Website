import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FiAlertTriangle, FiCheck, FiClock, FiEye, FiImage, FiPrinter, FiRefreshCw, FiTrash2, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { apiDelete, apiGet, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type ReservationStatus = 'pending' | 'needs review' | 'confirmed'

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
  fieldIds?: string[]
  fieldNames?: string
  locationId?: string
  locationName?: string
  slot?: string
  selectedPackageId?: string
  selectedGameplayName?: string
  packageName?: string
  mode?: string
  gameMode?: string
  sessionType?: string
  group?: string
  numberOfPlayers?: number
  totalAmount?: number
  notes?: string
  createdAtISO?: string
  updatedAtISO?: string
}

type PaymentDoc = {
  _id?: any
  id?: string
  reservationId?: string
  paymentMethod?: string
  paymentStatus?: string
  gcashImageUrl?: string
  transactionReference?: string
  amount?: number
  totalPHP?: number
  refNo?: string
  createdAtISO?: string
  updatedAtISO?: string
}

type UserAccountDoc = {
  _id?: any
  id?: string
  name?: string
  email?: string
}

type ReservationView = ReservationDoc & {
  payment?: PaymentDoc | null
}

const normalizeReservationStatus = (value: any): ReservationStatus | string => {
  const raw = String(value || '').trim()
  if (!raw) return 'pending'

  const lower = raw.toLowerCase()
  if (lower === 'pending') return 'pending'
  if (lower === 'needs review' || lower === 'needs_review' || lower === 'review') return 'needs review'
  if (lower === 'confirmed' || lower === 'approved') return 'confirmed'

  return raw
}

const normalizePaymentStatus = (value: any): string => {
  const raw = String(value || '').trim()
  if (!raw) return 'pending'
  return raw.toLowerCase()
}

const pillClass = (kind: 'pending' | 'review' | 'success' | 'danger' | 'muted') => {
  if (kind === 'success') return 'bg-success/20 text-success border-success/30'
  if (kind === 'danger') return 'bg-danger/20 text-danger border-danger/30'
  if (kind === 'review') return 'bg-accent/20 text-accent border-accent/30'
  return kind === 'pending' ? 'bg-white/5 text-text border-white/10' : 'bg-white/5 text-muted border-white/10'
}

const StatusPill = ({ status }: { status: string }) => {
  const normalized = String(status || '').toLowerCase()
  const tone =
    normalized === 'confirmed' || normalized === 'paid'
      ? 'success'
      : normalized === 'needs review' || normalized === 'review'
        ? 'review'
        : normalized === 'failed' || normalized === 'rejected'
          ? 'danger'
          : 'pending'

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${pillClass(tone)}`}>
      {normalized.toUpperCase() || 'PENDING'}
    </span>
  )
}

function getId(row: ReservationDoc | PaymentDoc) {
  if (row.id) return String(row.id)
  if (row._id) return String(row._id)
  return null
}

function formatMaybe(value: any, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function buildPrintableWindow(title: string, body: string) {
  const win = window.open('', '_blank', 'width=980,height=900')
  if (!win) {
    throw new Error('Popup blocked. Please allow popups to print.')
  }

  win.document.open()
  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          :root { color-scheme: dark; }
          html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: #0c0f14; color: #f4f4f5; }
          .page { padding: 24px; }
          .card { background: #131824; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 20px; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          .muted { color: #a1a1aa; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          td { border-top: 1px solid rgba(255,255,255,0.08); padding: 10px 0; vertical-align: top; }
          td.key { width: 32%; color: #a1a1aa; font-size: 12px; padding-right: 12px; }
          img { max-width: 100%; height: auto; display: block; margin-top: 16px; border-radius: 14px; }
          @media print { body { background: #fff; color: #000; } .page { padding: 0; } .card { border: none; } }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="card">${body}</div>
        </div>
      </body>
    </html>
  `)
  win.document.close()
  return win
}

function buildDetailsBody(reservation: ReservationView) {
  const payment = reservation.payment || null
  const rows = [
    ['Reservation ID', getId(reservation) || '—'],
    ['Reservation Status', normalizeReservationStatus(reservation.reservationStatus)],
    ['Customer', reservation.userName || reservation.player || '—'],
    ['Reservation Date', reservation.reservationDate || '—'],
    ['Reservation Time', reservation.reservationTime || reservation.slot || '—'],
    ['Field', reservation.fieldId || '—'],
    ['Session Type', reservation.sessionType || '—'],
    ['Game Mode', reservation.mode || reservation.gameMode || '—'],
    ['Package', reservation.packageName || reservation.selectedGameplayName || reservation.selectedPackageId || '—'],
    ['Group', reservation.group || '—'],
    ['Players', reservation.numberOfPlayers ?? '—'],
    ['Total Amount', reservation.totalAmount ? `₱${Number(reservation.totalAmount).toLocaleString()}` : '—'],
    ['Notes', reservation.notes || '—'],
    ['Created', reservation.createdAtISO || '—'],
    ['Updated', reservation.updatedAtISO || '—'],
    ['Payment Method', payment?.paymentMethod || '—'],
    ['Payment Status', payment?.paymentStatus || '—'],
    ['Reference No.', payment?.transactionReference || payment?.refNo || '—'],
    ['Payment Record ID', getId(payment || {}) || '—'],
  ]

  return `
    <h1>Reservation Details</h1>
    <div class="muted">${formatMaybe(getId(reservation))}</div>
    <table>
      ${rows.map(([key, value]) => `<tr><td class="key">${key}</td><td>${value}</td></tr>`).join('')}
    </table>
    ${payment?.gcashImageUrl ? `<div style="margin-top:20px"><div class="muted">GCash proof image</div><img src="${payment.gcashImageUrl}" alt="GCash proof" /></div>` : ''}
  `
}

function buildImageBody(imageUrl: string) {
  return `
    <h1>GCash Proof</h1>
    <div class="muted">Image only printout</div>
    <img src="${imageUrl}" alt="GCash proof" onload="window.focus();window.print();" />
  `
}

export function AdminReservationsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ReservationStatus>('pending')
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [payments, setPayments] = useState<PaymentDoc[]>([])
  const [users, setUsers] = useState<UserAccountDoc[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState<ReservationStatus | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [reservationRes, paymentRes, usersRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200'),
        apiGet<{ ok: boolean; data: UserAccountDoc[] }>('/api/user_accounts?limit=500'),
      ])

      setReservations(Array.isArray(reservationRes?.data) ? reservationRes.data : [])
      setPayments(Array.isArray(paymentRes?.data) ? paymentRes.data : [])
      setUsers(Array.isArray(usersRes?.data) ? usersRes.data : [])
    } catch (e: any) {
      const message = String(e?.message || e)
      setError(message)
      toast.error(message)
      setReservations([])
      setPayments([])
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reservationsWithPayments = useMemo<ReservationView[]>(() => {
    const paymentByReservationId = new Map<string, PaymentDoc>()
    for (const payment of payments) {
      const linkedReservationId = payment.reservationId ? String(payment.reservationId) : ''
      if (linkedReservationId) paymentByReservationId.set(linkedReservationId, payment)
    }

    return reservations.map((reservation) => {
      const reservationId = getId(reservation)
      return {
        ...reservation,
        payment: reservationId ? paymentByReservationId.get(reservationId) ?? null : null,
      }
    })
  }, [payments, reservations])

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of users) {
      const key = String(account.id || account._id || '').trim()
      if (key) map.set(key, String(account.name || account.email || key))
    }
    return map
  }, [users])

  const resolveCustomerName = (reservation: ReservationDoc) => {
    const userId = String(reservation.userId || '').trim()
    const byAccount = userId ? userNameById.get(userId) : ''
    return byAccount || reservation.userName || reservation.player || userId || '—'
  }

  const visibleRows = useMemo(() => {
    return reservationsWithPayments.filter((reservation) => normalizeReservationStatus(reservation.reservationStatus) === active)
  }, [active, reservationsWithPayments])

  const selectedReservation = useMemo(() => {
    if (!selectedId) return null
    return reservationsWithPayments.find((reservation) => getId(reservation) === selectedId) ?? null
  }, [reservationsWithPayments, selectedId])

  const counts = useMemo(() => {
    const next = { pending: 0, 'needs review': 0, confirmed: 0 }
    for (const reservation of reservationsWithPayments) {
      const normalized = normalizeReservationStatus(reservation.reservationStatus)
      if (normalized === 'pending') next.pending++
      else if (normalized === 'needs review') next['needs review']++
      else if (normalized === 'confirmed') next.confirmed++
    }
    return next
  }, [reservationsWithPayments])

  const openReview = (reservation: ReservationView) => {
    const reservationId = getId(reservation)
    if (!reservationId) return toast.error('Reservation id missing')
    setSelectedId(reservationId)
  }

  const { addNotification } = useNotifications()

  const updateReservation = async (nextStatus: ReservationStatus) => {
    if (!selectedReservation) return
    const reservationId = getId(selectedReservation)
    if (!reservationId) return toast.error('Reservation id missing')
    if (!user?.id) return toast.error('Not logged in')

    try {
      setSavingStatus(nextStatus)
      await apiPut(`/api/reservations/${reservationId}/status`, {
        userId: user.id,
        role: user.role,
        reservationStatus: nextStatus,
      })

      setReservations((current) =>
        current.map((item) => {
          const currentId = getId(item)
          if (currentId !== reservationId) return item
          return { ...item, reservationStatus: nextStatus }
        })
      )

      if (nextStatus === 'confirmed') setActive('confirmed')
      else if (nextStatus === 'needs review') setActive('needs review')
      else setActive('pending')

      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'reservation_status_update',
        title: 'Reservation Update Received',
        message: `Reservation ${reservationId} was moved to ${nextStatus}.`,
        linkedResourceId: reservationId,
      })

      if (nextStatus === 'confirmed') {
        sendRoleNotifications(addNotification, {
          roles: ['admin', 'registrar', 'marshal'],
          type: 'gameplay_created',
          title: 'Gameplay Session Ready',
          message: `Gameplay for reservation ${reservationId} is ready to be managed.`,
          linkedResourceId: reservationId,
        })
      }

      // Notify the customer if reservation was confirmed
      if (nextStatus === 'confirmed' && selectedReservation.userId) {
        addNotification({
          userId: selectedReservation.userId,
          type: 'reservation_confirmed',
          title: 'Reservation Confirmed',
          message: `Your reservation ${reservationId} has been confirmed. Payment has been verified.`,
          linkedResourceId: reservationId,
        })
      }

      setSelectedId(null)
      toast.success(`Reservation marked as ${nextStatus}`)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSavingStatus(null)
    }
  }

  const printReservationDetails = () => {
    if (!selectedReservation) return
    const reservationId = getId(selectedReservation) || 'reservation'
    const win = buildPrintableWindow(`Reservation ${reservationId}`, buildDetailsBody(selectedReservation))
    setTimeout(() => win.print(), 350)
  }

  const printReservationImage = () => {
    const imageUrl = selectedReservation?.payment?.gcashImageUrl
    if (!imageUrl) return toast.error('No GCash image found for this reservation')
    const reservationId = getId(selectedReservation || {}) || 'reservation'
    buildPrintableWindow(`GCash proof ${reservationId}`, buildImageBody(imageUrl))
  }

  const deleteReservation = async () => {
    if (!selectedReservation) return
    const reservationId = getId(selectedReservation)
    if (!reservationId) return toast.error('Reservation id missing')

    if (!window.confirm(`Are you sure you want to delete reservation ${reservationId}?\n\nThis will also delete linked payment records and gameplay data. This action cannot be undone.`)) {
      return
    }

    try {
      await apiDelete(`/api/reservations/${reservationId}?role=${user?.role || ''}`)
      toast.success('Reservation deleted successfully')
      setSelectedId(null)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reservations</h1>
          <p className="mt-1 text-sm text-muted">Review reservations, inspect GCash proof, and move bookings through the approval queue.</p>
        </div>

        <FilterTabs
          ariaLabel="Filter reservations by status"
          value={active}
          onChange={setActive}
          options={([
            ['pending', counts.pending],
            ['needs review', counts['needs review']],
            ['confirmed', counts.confirmed],
          ] as const).map(([status, count]) => ({ value: status, label: titleCaseLabel(status), count }))}
        />
      </div>

      <Card className="p-4">
        {error ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger">
            <FiAlertTriangle className="mr-2 inline-block" /> {error}
          </div>
        ) : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="hidden sm:grid sm:grid-cols-12 gap-0 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="sm:col-span-2">ID</div>
            <div className="sm:col-span-3">Customer</div>
            <div className="sm:col-span-3">Schedule</div>
            <div className="sm:col-span-2">Payment</div>
            <div className="sm:col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading reservations…</div>
            ) : visibleRows.length === 0 ? (
              <div className="p-6 text-sm text-muted">No reservations found for this status.</div>
            ) : (
              visibleRows.map((reservation) => {
                const reservationId = getId(reservation)
                const reservationStatus = normalizeReservationStatus(reservation.reservationStatus)
                const payment = reservation.payment

                return (
                  <div key={reservationId ?? Math.random()} className="flex flex-col gap-2 sm:grid sm:grid-cols-12 sm:items-center px-3 py-3">
                    <div className="flex items-center justify-between sm:col-span-2">
                      <span className="text-sm font-semibold">{reservationId ?? '—'}</span>
                      <span className="sm:hidden"><StatusPill status={reservationStatus} /></span>
                    </div>
                    <div className="sm:col-span-3 text-sm text-muted">{resolveCustomerName(reservation)}</div>
                    <div className="sm:col-span-3 text-sm text-muted">
                      <div>{[reservation.reservationDate, reservation.reservationTime].filter(Boolean).join(' • ') || reservation.createdAtISO || '—'}</div>
                      <div className="mt-0.5 text-xs text-muted/70">
                        {reservation.locationName || ''}{reservation.locationName && reservation.fieldNames ? ' • ' : ''}{reservation.fieldNames || reservation.fieldId || ''}
                      </div>
                    </div>
                    <div className="sm:col-span-2 text-sm text-muted">
                      <div className="flex flex-col gap-1">
                        <StatusPill status={reservationStatus} />
                        <span className="text-xs text-muted">
                          {payment?.paymentMethod || '—'}
                          {payment?.gcashImageUrl ? ' • proof attached' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="sm:col-span-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="xs" variant="ghost" onClick={() => openReview(reservation)}>
                          <FiEye /> Review
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">Live from MongoDB • review modal can update reservation and linked payment states</div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <FiRefreshCw /> Refresh
          </Button>
        </div>
      </Card>

      {selectedReservation && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
              <div className="relative z-[100000] max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-background shadow-soft">
                <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4 md:p-5">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted">Reservation review</div>
                    <h2 className="mt-1 text-2xl font-bold">{getId(selectedReservation) || 'Reservation details'}</h2>
                    <p className="mt-1 text-sm text-muted">Update status, inspect proof, and print details or only the GCash image.</p>
                  </div>

                  <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)} aria-label="Close" className="w-10 px-0">
                    <FiX />
                  </Button>
                </div>

                <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
                  <div className="max-h-[calc(92vh-120px)] overflow-y-auto p-4 md:p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card className="p-4">
                        <div className="text-xs uppercase tracking-widest text-muted">Reservation</div>
                        <div className="mt-3 space-y-3 text-sm">
                          {[
                            ['Customer', resolveCustomerName(selectedReservation)],
                            ['Reservation date', selectedReservation.reservationDate || '—'],
                            ['Reservation time', selectedReservation.reservationTime || selectedReservation.slot || '—'],
                            ['Location', selectedReservation.locationName || '—'],
                            ['Field', (selectedReservation.fieldNames || selectedReservation.fieldId || '—')],
                            ['Session type', selectedReservation.sessionType || '—'],
                            ['Game mode', selectedReservation.mode || selectedReservation.gameMode || '—'],
                            ['Package', selectedReservation.packageName || selectedReservation.selectedGameplayName || selectedReservation.selectedPackageId || '—'],
                            ['Group', selectedReservation.group || '—'],
                            ['Players', selectedReservation.numberOfPlayers ?? '—'],
                            ['Total amount', selectedReservation.totalAmount ? `₱${Number(selectedReservation.totalAmount).toLocaleString()}` : '—'],
                            ['Notes', selectedReservation.notes || '—'],
                            ['Created', selectedReservation.createdAtISO || '—'],
                            ['Updated', selectedReservation.updatedAtISO || '—'],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                              <div className="text-muted">{label}</div>
                              <div className="text-right font-semibold text-text">{value}</div>
                            </div>
                          ))}
                        </div>
                      </Card>

                      <Card className="p-4">
                        <div className="text-xs uppercase tracking-widest text-muted">Payment</div>
                        <div className="mt-3 space-y-3 text-sm">
                          {[
                            ['Payment method', selectedReservation.payment?.paymentMethod || '—'],
                            ['Payment status', selectedReservation.payment?.paymentStatus || '—'],
                            ['Reference no.', selectedReservation.payment?.transactionReference || selectedReservation.payment?.refNo || '—'],
                            ['Amount', selectedReservation.payment?.amount ?? selectedReservation.totalAmount ?? '—'],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                              <div className="text-muted">{label}</div>
                              <div className="text-right font-semibold text-text">{value}</div>
                            </div>
                          ))}
                        </div>

                        {selectedReservation.payment?.paymentMethod?.toLowerCase() === 'gcash' && selectedReservation.payment.gcashImageUrl ? (
                          <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-3">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted">
                              <FiImage /> GCash proof
                            </div>
                            <img
                              src={selectedReservation.payment.gcashImageUrl}
                              alt="GCash proof"
                              className="mt-3 max-h-[320px] w-full rounded-2xl border border-white/10 object-contain bg-black/20"
                            />
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-muted">
                            No GCash proof image attached for this reservation.
                          </div>
                        )}
                      </Card>
                    </div>
                  </div>

                  <div className="border-t border-white/5 p-4 lg:border-l lg:border-t-0 md:p-5">
                    <div className="text-xs uppercase tracking-widest text-muted">Status actions</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill status={normalizeReservationStatus(selectedReservation.reservationStatus)} />
                    </div>

                    {/* Main decision first, secondary status changes beside each other, utilities after,
                        and the destructive delete set apart at the bottom. */}
                    <div className="mt-4 grid gap-2">
                      <Button
                        className="w-full"
                        variant="primary"
                        disabled={savingStatus !== null}
                        onClick={() => updateReservation('confirmed')}
                      >
                        <FiCheck /> Confirm reservation
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="ghost" disabled={savingStatus !== null} onClick={() => updateReservation('pending')}>
                          <FiClock /> Mark pending
                        </Button>
                        <Button size="sm" variant="accent-soft" disabled={savingStatus !== null} onClick={() => updateReservation('needs review')}>
                          <FiEye /> Needs review
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-white/5 bg-white/5 p-3 text-xs text-muted">
                      Confirming the reservation also updates the linked payment to <span className="font-semibold text-text">confirmed</span> and creates gameplay once.
                    </div>

                    <div className="mt-5 text-xs uppercase tracking-widest text-muted">Print</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button size="sm" variant="ghost" onClick={printReservationDetails}>
                        <FiPrinter /> Details
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!(selectedReservation.payment?.paymentMethod?.toLowerCase() === 'gcash' && selectedReservation.payment?.gcashImageUrl)}
                        onClick={printReservationImage}
                      >
                        <FiImage /> Proof image
                      </Button>
                    </div>

                    <div className="mt-6 border-t border-white/5 pt-4">
                      <Button size="sm" variant="danger-soft" className="w-full" onClick={deleteReservation}>
                        <FiTrash2 /> Delete reservation
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

