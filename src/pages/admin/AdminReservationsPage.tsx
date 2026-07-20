import React, { useEffect, useMemo, useState } from 'react'
import { FiAlertTriangle, FiCheck, FiChevronRight, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

type ReservationStatus = 'pending' | 'Confirmed' | 'rejected' | 'Pending' | 'approved' | 'rejected' | string

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
  slot?: string

  selectedPackageId?: string
  selectedGameplayName?: string
  packageName?: string

  mode?: string
  group?: string
  numberOfPlayers?: number
  totalAmount?: number

  createdAtISO?: string
  updatedAtISO?: string
}

const normalizeReservationStatus = (s: any): string => {
  const raw = String(s || '').trim()
  if (!raw) return 'pending'
  const lower = raw.toLowerCase()
  if (lower === 'pending') return 'pending'
  if (lower === 'confirmed') return 'Confirmed'
  if (lower === 'rejected') return 'rejected'
  if (lower === 'approved') return 'Confirmed'
  return raw
}

const Pill = ({ tone, children }: { tone: 'accent' | 'success' | 'danger' | 'muted'; children: React.ReactNode }) => {
  const cls =
    tone === 'accent'
      ? 'bg-accent/20 text-accent'
      : tone === 'success'
        ? 'bg-success/20 text-success'
        : tone === 'danger'
          ? 'bg-danger/20 text-danger'
          : 'bg-white/5 text-text'

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  )
}

export function AdminReservationsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [active, setActive] = useState<'pending' | 'Confirmed' | 'rejected'>('pending')
  const [reservations, setReservations] = useState<ReservationDoc[]>([])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []
      setReservations(docs)
    } catch (e: any) {
      setError(String(e?.message || e))
      toast.error(String(e?.message || e))
      setReservations([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    return reservations
      .map((r) => ({ ...r, reservationStatusNorm: normalizeReservationStatus(r.reservationStatus) }))
      .filter((r) => r.reservationStatusNorm === active)
  }, [reservations, active])

  const toneFor = (st: string) => {
    if (st === 'Confirmed') return 'success'
    if (st === 'rejected') return 'danger'
    return 'accent'
  }

  const getId = (r: ReservationDoc) => {
    if (r._id) return String(r._id)
    if (r.id) return String(r.id)
    return null
  }

  const approveReject = async (r: ReservationDoc, nextStatus: 'Confirmed' | 'rejected') => {
    const id = getId(r)
    if (!id) return toast.error('Reservation id missing')
    if (!user?.id) return toast.error('Not logged in')

    try {
      toast.loading(nextStatus === 'Confirmed' ? 'Confirming reservation…' : 'Rejecting reservation…')

      // Workflow endpoint requirement: when admin sets to Confirmed => backend creates gameplay.
      const payload = {
        userId: user.id,
        role: user.role,
        reservationStatus: nextStatus,
      }

      await apiPut(`/api/reservations/${id}/confirm`, payload)

      toast.dismiss()
      toast.success('Reservation updated')
      await refresh()
    } catch (e: any) {
      toast.dismiss()
      toast.error(String(e?.message || e))
    }
  }

  const headerCounts = useMemo(() => {
    const c = { pending: 0, Confirmed: 0, rejected: 0 }
    for (const r of reservations) {
      const n = normalizeReservationStatus(r.reservationStatus)
      if (n === 'pending') c.pending++
      else if (n === 'Confirmed') c.Confirmed++
      else if (n === 'rejected') c.rejected++
    }
    return c
  }, [reservations])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reservations</h1>
          <p className="text-muted text-sm mt-1">Approve reservations. Confirmed reservations auto-create gameplay.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['pending', 'Confirmed', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (active === s ? 'bg-white/8 text-text border-accent/30' : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              <span className="font-semibold">{s.toUpperCase()}</span>
              <span className="ml-2 text-muted">({headerCounts[s]})</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4">
        {error ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger">
            <FiAlertTriangle className="inline-block mr-2" /> {error}
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 gap-0 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-3">Player</div>
            <div className="col-span-3">Date/Time</div>
            <div className="col-span-2">Players</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading reservations…</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-muted">No reservations found for this status.</div>
            ) : (
              rows.map((r) => {
                const id = getId(r)
                const statusNorm = normalizeReservationStatus(r.reservationStatus)
                return (
                  <div key={id ?? Math.random()} className="grid grid-cols-12 items-center px-3 py-3">
                    <div className="col-span-2 text-sm font-semibold">{id ?? '—'}</div>
                    <div className="col-span-3 text-sm text-muted">{r.userName || r.player || '—'}</div>
                    <div className="col-span-3 text-sm text-muted">
                      {[r.reservationDate, r.reservationTime].filter(Boolean).join(' • ') || r.createdAtISO || '—'}
                    </div>
                    <div className="col-span-2 text-sm text-muted">{r.numberOfPlayers ?? '—'}</div>
                    <div className="col-span-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Pill tone={toneFor(statusNorm)}>{statusNorm.toUpperCase()}</Pill>

                        {statusNorm === 'pending' ? (
                          <>
                            <button
                              onClick={() => approveReject(r, 'Confirmed')}
                              className="rounded-xl bg-success/20 border border-success/30 px-3 py-2 text-xs font-semibold text-success hover:bg-success/25 transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => approveReject(r, 'rejected')}
                              className="rounded-xl bg-danger/20 border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/25 transition"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <button
                            disabled
                            className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs font-semibold text-muted opacity-60"
                            title="Only pending reservations can be actioned"
                          >
                            <FiChevronRight className="inline-block mr-1" /> Review
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">Live from MongoDB • updates after status change</div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </div>
      </Card>
    </div>
  )
}

