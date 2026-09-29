import React, { useEffect, useMemo, useState } from 'react'
import {
  FiCheck,
  FiClock,
  FiShield,
  FiX,
} from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type ReservationStatus = 'pending' | 'approved' | 'rejected'

type ReservationRow = {
  id: string
  createdAtISO: string
  dateISO: string
  locationName: string
  fieldName: string
  slotLabel: string
  sessionType: 'Public' | 'Private'
  players: number
  gameMode: string
  packageName: string
  status: ReservationStatus
  reservationStatus?: string
  userId?: string
  reservationDate?: string
  reservationTime?: string
  notes?: string
  totalAmount?: number
}

function fmtDate(value?: string) {
  if (!value) return '—'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString()
  } catch {
    return value
  }
}

function normalizeStatus(value?: string): ReservationStatus {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'confirmed' || raw === 'approved') return 'approved'
  if (raw === 'rejected' || raw === 'needs review' || raw === 'needs_review' || raw === 'review') return 'rejected'
  return 'pending'
}

function StatusPill({ status }: { status: ReservationStatus }) {
  const conf =
    status === 'approved'
      ? { cls: 'bg-success/15 text-success border-success/30', label: 'APPROVED' }
      : status === 'rejected'
        ? { cls: 'bg-danger/15 text-danger border-danger/30', label: 'REJECTED' }
        : { cls: 'bg-accent/15 text-gold border-accent/30', label: 'PENDING' }

  return (
    <span className={[
      'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
      conf.cls,
    ].join(' ')}>
      {conf.label}
    </span>
  )
}

export function RegistrarReservationsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ReservationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200')
      const data = Array.isArray(res?.data) ? res.data : []
      const mapped = data.map((item) => ({
        id: String(item.id || item._id || ''),
        createdAtISO: item.createdAtISO || item.createdAt || '',
        dateISO: fmtDate(item.reservationDate || item.dateISO),
        locationName: item.locationName || item.locationId || '—',
        fieldName: item.fieldName || item.fieldId || '—',
        slotLabel: item.slotLabel || item.reservationTime || '—',
        sessionType: (item.sessionType || item.type || 'Public') as 'Public' | 'Private',
        players: Number(item.numberOfPlayers || item.players || 0),
        gameMode: item.gameMode || item.mode || '—',
        packageName: item.packageName || item.selectedGameplayName || '—',
        status: normalizeStatus(item.reservationStatus),
        reservationStatus: item.reservationStatus,
        userId: item.userId,
        reservationDate: item.reservationDate,
        reservationTime: item.reservationTime,
        notes: item.notes,
        totalAmount: item.totalAmount,
      }))
      setRows(mapped)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.fieldName.toLowerCase().includes(q) ||
        r.packageName.toLowerCase().includes(q) ||
        r.gameMode.toLowerCase().includes(q)
      )
    })
  }, [query, rows])

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows])

  const { addNotification } = useNotifications()

  const updateReservation = async (id: string, nextStatus: 'approved' | 'rejected') => {
    if (!user?.id) return toast.error('Please sign in to continue')
    setSavingId(id)
    try {
      const row = rows.find((r) => r.id === id)

      await apiPut(`/api/reservations/${encodeURIComponent(id)}/status`, {
        userId: user.id,
        role: user.role,
        reservationStatus: nextStatus === 'approved' ? 'confirmed' : 'rejected',
      })

      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: nextStatus === 'approved' ? 'reservation_approved' : 'reservation_rejected',
        title: nextStatus === 'approved' ? 'Reservation Approved' : 'Reservation Rejected',
        message: nextStatus === 'approved'
          ? `Reservation ${id} was approved.`
          : `Reservation ${id} was rejected.`,
        linkedResourceId: id,
      })

      if (nextStatus === 'approved') {
        sendRoleNotifications(addNotification, {
          roles: ['admin', 'registrar', 'marshal'],
          type: 'gameplay_created',
          title: 'Gameplay Session Ready',
          message: `Gameplay for reservation ${id} is ready to be managed.`,
          linkedResourceId: id,
        })
      }

      // Notify the customer
      if (row?.userId) {
        addNotification({
          userId: row.userId,
          type: nextStatus === 'approved' ? 'reservation_approved' : 'reservation_rejected',
          title: nextStatus === 'approved' ? 'Reservation Approved' : 'Reservation Rejected',
          message: nextStatus === 'approved'
            ? `Your reservation ${id} has been approved and confirmed.`
            : `Your reservation ${id} has been rejected. Please contact support for more details.`,
          linkedResourceId: id,
        })
      }

      toast.success(`Reservation ${nextStatus}`)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSavingId(null)
    }
  }

  const approve = (id: string) => void updateReservation(id, 'approved')
  const reject = (id: string) => void updateReservation(id, 'rejected')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Registrar</span>
        </div>
        <h1 className="text-3xl font-bold">Approve Reservations</h1>
        <p className="text-muted text-sm">Review live reservation requests and approve or reject them from the queue.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending</div>
          <div className="mt-2 text-2xl font-bold text-accent">{pendingCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Approved</div>
          <div className="mt-2 text-2xl font-bold text-success">{rows.filter((r) => r.status === 'approved').length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Rejected</div>
          <div className="mt-2 text-2xl font-bold text-danger">{rows.filter((r) => r.status === 'rejected').length}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Queue</span>
            </div>
            <div className="mt-1 text-xs text-muted">Filter by reservation id, field, package, or game mode.</div>
          </div>

          <div className="md:w-[380px]">
            <Input label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g., res-1200" />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">Reservation</th>
                <th className="py-2 pr-3">Schedule</th>
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">Group</th>
                <th className="py-2 pr-3">Package</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-muted">
                    Loading reservations…
                  </td>
                </tr>
              ) : null}

              {!loading && filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.id}</div>
                    <div className="mt-1 text-xs text-muted">{r.createdAtISO ? new Date(r.createdAtISO).toLocaleDateString() : '—'}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.dateISO}</div>
                    <div className="mt-1 text-xs text-muted">{r.locationName}</div>
                    <div className="text-xs text-muted/70">{r.fieldName} • {r.slotLabel}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.sessionType}</div>
                    <div className="mt-1 text-xs text-muted">{r.gameMode}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.players} players</div>
                    <div className="mt-1 text-xs text-muted">{r.notes || 'No extra notes'}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.packageName}</div>
                    <div className="mt-1 text-xs text-muted">{r.totalAmount ? `₱${r.totalAmount.toLocaleString()}` : 'Amount pending'}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-3 pr-3">
                    {r.status === 'pending' ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button variant="primary" className="w-full sm:w-auto" onClick={() => approve(r.id)} disabled={savingId === r.id}>
                          <FiCheck /> {savingId === r.id ? 'Saving…' : 'Approve'}
                        </Button>
                        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => reject(r.id)} disabled={savingId === r.id}>
                          <FiX /> {savingId === r.id ? 'Saving…' : 'Reject'}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs text-muted">No action</div>
                    )}
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-muted">
                    No reservations match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiClock className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Registrar workflow</div>
              <div className="mt-1 text-xs text-muted">
                Approve moves a reservation to <span className="font-bold text-success">APPROVED</span>. Rejection moves it to <span className="font-bold text-danger">REJECTED</span>. In a real backend, this would also reserve capacity and notify marshals.
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

