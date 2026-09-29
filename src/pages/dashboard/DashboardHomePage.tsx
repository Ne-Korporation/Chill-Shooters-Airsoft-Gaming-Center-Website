import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { apiGet } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

type ActivityTone = 'accent' | 'success' | 'danger' | 'muted'

type ActivityItem = {
  title: string
  subtitle: string
  meta: string
  tone: ActivityTone
  dateValue: number
}

type DashboardState = {
  totalReservations: number
  upcomingReservations: number
  pendingPayments: number
  waiverStatus: string
  statusLabel: string
  statusTone: ActivityTone
  nextReservation: string
  recentActivity: ActivityItem[]
}

const defaultState: DashboardState = {
  totalReservations: 0,
  upcomingReservations: 0,
  pendingPayments: 0,
  waiverStatus: 'Not submitted',
  statusLabel: 'Loading your dashboard…',
  statusTone: 'muted',
  nextReservation: 'No bookings yet',
  recentActivity: [],
}

function formatRelativeTime(value?: string) {
  if (!value) return 'recently updated'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatReservationDate(value?: string) {
  if (!value) return 'TBD'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'TBD'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function matchesUserRecord(record: unknown, userId?: string) {
  if (!userId) return false
  const rawValue = record == null ? '' : String(record)
  return rawValue === String(userId)
}

export function DashboardHomePage() {
  const { user } = useAuth()
  const [dashboard, setDashboard] = useState<DashboardState>(defaultState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setLoading(true)

      if (!user?.id) {
        if (isMounted) {
          setDashboard({
            ...defaultState,
            statusLabel: 'Sign in to view your bookings',
            statusTone: 'accent',
          })
          setLoading(false)
        }
        return
      }

      try {
        const [reservationsRes, paymentsRes, waiversRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const waivers = Array.isArray(waiversRes?.data) ? waiversRes.data : []

        const normalize = (value?: string) => String(value || '').trim().toLowerCase()
        const formatStatus = (value?: string) => {
          const normalized = normalize(value)
          if (normalized === 'approved') return 'Approved'
          if (normalized === 'denied') return 'Denied'
          return 'Pending'
        }

        const parseDate = (value?: string) => {
          const timestamp = Date.parse(String(value || ''))
          return Number.isNaN(timestamp) ? 0 : timestamp
        }

        const myReservations = reservations.filter((reservation) =>
          matchesUserRecord(reservation?.userId, user.id)
          || matchesUserRecord(reservation?.playerId, user.id)
          || matchesUserRecord(reservation?.accountId, user.id)
          || matchesUserRecord(reservation?.submittedBy, user.id),
        )

        const myPayments = payments.filter((payment) =>
          matchesUserRecord(payment?.userId, user.id)
          || matchesUserRecord(payment?.playerId, user.id)
          || matchesUserRecord(payment?.accountId, user.id),
        )

        const myWaivers = waivers.filter((waiver) =>
          matchesUserRecord(waiver?.userId, user.id)
          || matchesUserRecord(waiver?.playerId, user.id)
          || matchesUserRecord(waiver?.accountId, user.id),
        )

        const upcomingReservations = myReservations.filter((reservation) => {
          const status = normalize(reservation?.reservationStatus)
          return status === 'confirmed' || status === 'approved'
        }).length

        const pendingPayments = myPayments.filter((payment) => {
          const status = normalize(payment?.paymentStatus || payment?.status)
          return status === 'pending' || status === 'submitted' || status === 'review'
        }).length

        const waiverEntry = myWaivers
          .slice()
          .sort((a, b) => parseDate(b.submittedAtISO || b.createdAtISO) - parseDate(a.submittedAtISO || a.createdAtISO))[0]
        const waiverStatus = waiverEntry ? formatStatus(waiverEntry.status) : 'Not submitted'

        const nextReservation = myReservations
          .filter((reservation) => {
            const status = normalize(reservation?.reservationStatus)
            return status === 'confirmed' || status === 'approved'
          })
          .sort((a, b) => (b.reservationDate || b.createdAtISO || '').localeCompare(a.reservationDate || a.createdAtISO || ''))[0]

        const activityRows: ActivityItem[] = []
        myReservations
          .slice()
          .sort((a, b) => (parseDate(b.updatedAtISO || b.createdAtISO) - parseDate(a.updatedAtISO || a.createdAtISO)))
          .slice(0, 2)
          .forEach((reservation) => {
            const status = String(reservation?.reservationStatus || 'pending')
            const eventTime = parseDate(reservation?.updatedAtISO || reservation?.createdAtISO)
            activityRows.push({
              title: `Reservation ${status}`,
              subtitle: reservation?.id || 'Reservation update',
              meta: formatRelativeTime(reservation?.updatedAtISO || reservation?.createdAtISO),
              tone: status === 'confirmed' || status === 'approved' ? 'success' : 'accent',
              dateValue: eventTime,
            })
          })

        myPayments
          .slice()
          .sort((a, b) => (parseDate(b.updatedAtISO || b.createdAtISO) - parseDate(a.updatedAtISO || a.createdAtISO)))
          .slice(0, 2)
          .forEach((payment) => {
            const paymentStatus = String(payment?.paymentStatus || payment?.status || 'pending')
            const eventTime = parseDate(payment?.updatedAtISO || payment?.createdAtISO)
            activityRows.push({
              title: `Payment ${paymentStatus}`,
              subtitle: payment?.transactionReference || payment?.refNo || payment?.id || 'Receipt pending',
              meta: formatRelativeTime(payment?.updatedAtISO || payment?.createdAtISO),
              tone: paymentStatus === 'confirmed' || paymentStatus === 'paid' ? 'success' : 'danger',
              dateValue: eventTime,
            })
          })

        if (waiverEntry) {
          const eventTime = parseDate(waiverEntry.submittedAtISO || waiverEntry.createdAtISO)
          activityRows.push({
            title: `Waiver ${String(waiverEntry.status || 'pending')}`,
            subtitle: waiverEntry?.fullName || waiverEntry?.id || 'Waiver update',
            meta: formatRelativeTime(waiverEntry?.submittedAtISO || waiverEntry?.createdAtISO),
            tone: String(waiverEntry.status || '').toLowerCase() === 'approved' ? 'success' : 'accent',
            dateValue: eventTime,
          })
        }

        const nextState: DashboardState = {
          totalReservations: myReservations.length,
          upcomingReservations,
          pendingPayments,
          waiverStatus,
          statusLabel: pendingPayments > 0 ? 'You have payments to follow up on' : 'You are all set for your next session',
          statusTone: pendingPayments > 0 ? 'danger' : 'success',
          nextReservation: nextReservation
            ? `${formatReservationDate(nextReservation.reservationDate || nextReservation.date || nextReservation.createdAtISO)} • ${nextReservation.reservationTime || 'Time pending'}`
            : 'No confirmed bookings yet',
          recentActivity: activityRows
            .sort((a, b) => b.dateValue - a.dateValue)
            .slice(0, 4),
        }

        if (isMounted) setDashboard(nextState)
      } catch (error: any) {
        if (isMounted) {
          toast.error(String(error?.message || error))
          setDashboard(defaultState)
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void load()
    return () => {
      isMounted = false
    }
  }, [user?.id])

  const statusClass = useMemo(() => {
    if (dashboard.statusTone === 'danger') return 'text-danger'
    if (dashboard.statusTone === 'accent') return 'text-accent'
    if (dashboard.statusTone === 'success') return 'text-success'
    return 'text-muted'
  }, [dashboard.statusTone])

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Player</span>
        </div>
        <h1 className="text-3xl font-bold">Welcome back, {user?.name || 'player'}</h1>
        <p className="text-muted text-sm">Your bookings, payments, and waiver updates in one place.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">My Reservations</div>
          <div className="mt-2 text-2xl font-bold text-accent">{loading ? '…' : dashboard.totalReservations}</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Upcoming Bookings</div>
          <div className="mt-2 text-2xl font-bold text-success">{loading ? '…' : dashboard.upcomingReservations}</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending Payments</div>
          <div className="mt-2 text-2xl font-bold text-danger">{loading ? '…' : dashboard.pendingPayments}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Your next step</div>
          <div className={`mt-2 text-lg font-bold ${statusClass}`}>{dashboard.statusLabel}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted">Next booking</div>
              <div className="mt-2 text-sm font-semibold">{loading ? '…' : dashboard.nextReservation}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted">Waiver status</div>
              <div className="mt-2 text-sm font-semibold">{loading ? '…' : dashboard.waiverStatus}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Recent Activity</div>
          <div className="mt-3 space-y-2">
            {dashboard.recentActivity.length === 0 && !loading ? (
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">No activity recorded yet.</div>
            ) : (
              dashboard.recentActivity.map((item, index) => (
                <div key={`${item.title}-${index}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{item.title}</div>
                      <div className="mt-1 text-xs text-muted">{item.subtitle}</div>
                    </div>
                    <div className="text-[11px] text-muted">{item.meta}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
