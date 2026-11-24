import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { FiShield, FiTrash2 } from 'react-icons/fi'
import { isAdminAnnouncement, type NotificationItem } from '../../context/NotificationContext'
import { apiGet } from '../../utils/apiClient'
import { kindOf } from '../../utils/notificationDisplay'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'
import { reservationStatusLabel } from '../../utils/reservationStatus'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type LinkedReservation = {
  id?: string
  reservationDate?: string
  reservationTime?: string
  locationName?: string
  numberOfPlayers?: number
  reservationStatus?: string
  cancellationReason?: string
}

function longDate(dateISO?: string) {
  if (!dateISO) return ''
  const date = new Date(`${dateISO}T12:00:00`)
  return Number.isNaN(date.getTime()) ? dateISO : date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function sentLabel(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

// One notification, opened from the bell: what happened, the booking it's about as labelled
// rows (when it links to one the viewer can see), when it was sent, and a button to its page.
export function NotificationDetailModal({
  notification,
  role,
  userId,
  onClose,
  onRemove,
}: {
  notification: NotificationItem
  role?: string
  userId: string
  onClose: () => void
  // Shown as a Remove button when given (the Notifications page); the bell leaves it out.
  onRemove?: () => void
}) {
  const navigate = useNavigate()
  const slotHours = useSlotHours()
  const kind = kindOf(notification)
  const Icon = kind.icon
  const destination = resolveNotificationRoute(notification, role, userId)
  const linkedId = String(notification.linkedResourceId || '')
  const [reservation, setReservation] = useState<LinkedReservation | null>(null)

  // Bookings show their details; anything the viewer can't open just shows the message.
  useEffect(() => {
    if (!linkedId.startsWith('R-')) return
    let alive = true
    apiGet<{ ok: boolean; data: LinkedReservation }>(`/api/reservations/${encodeURIComponent(linkedId)}`)
      .then((res) => { if (alive) setReservation(res?.data || null) })
      .catch(() => { if (alive) setReservation(null) })
    return () => { alive = false }
  }, [linkedId])

  const slot = String(reservation?.reservationTime || '')
  const rows: Array<[string, React.ReactNode]> = reservation
    ? ([
        ['Date', longDate(reservation.reservationDate)],
        ['Time', slot ? `${slot.charAt(0).toUpperCase()}${slot.slice(1)} · ${formatSlotRange(slotHours, slot)}` : ''],
        ['Location', reservation.locationName || ''],
        ['Players', reservation.numberOfPlayers ? String(reservation.numberOfPlayers) : ''],
        ['Status', reservationStatusLabel(reservation)],
        ['Reservation', <span key="id" className="font-mono text-xs">{reservation.id || linkedId}</span>],
      ] as Array<[string, React.ReactNode]>).filter(([, value]) => value !== '')
    : []

  return (
    <Modal
      eyebrow={kind.label}
      title={notification.title}
      size="md"
      confirmDiscard={false}
      onClose={onClose}
      footer={
        <>
          {onRemove ? <Button variant="danger-soft" onClick={onRemove} className="mr-auto"><FiTrash2 /> Remove</Button> : null}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {destination ? (
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                navigate(destination)
              }}
            >
              View
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {isAdminAnnouncement(notification) ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <FiShield className="h-4 w-4 shrink-0 text-amber-500" />
            <span><span className="font-semibold text-amber-600 dark:text-amber-400">Sent by Admin</span><span className="text-muted"> · Chill Shooters management</span></span>
          </div>
        ) : null}
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <Icon className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-2 text-sm text-text">{notification.message}</p>
        </div>

        {rows.length ? (
          <dl className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="text-[11px] text-muted">Sent {sentLabel(notification.createdAtISO)}</div>
      </div>
    </Modal>
  )
}
