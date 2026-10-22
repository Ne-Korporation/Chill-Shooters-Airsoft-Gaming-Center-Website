import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { Link } from 'react-router-dom'
import { FiCalendar, FiCheckCircle, FiCreditCard, FiPlus, FiShield } from 'react-icons/fi'
import { ActivityList, DashboardHeader, Panel, StatTile, type ActivityTone } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'


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

  const firstName = String(user?.name || 'player').trim().split(/\s+/)[0]
  const waiverApproved = dashboard.waiverStatus === 'Approved'

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Player dashboard"
        title={`Welcome back, ${firstName}`}
        description="Your bookings, payments, and waiver in one place."
        actions={
          <Link
            to="/app/reservations"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <FiPlus /> Book a game
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="My reservations"
          value={dashboard.totalReservations}
          icon={FiCalendar}
          hint="All time"
          loading={loading}
        />
        <StatTile
          label="Upcoming bookings"
          value={dashboard.upcomingReservations}
          icon={FiCheckCircle}
          hint="Confirmed and ready"
          loading={loading}
        />
        <StatTile
          label="Pending payments"
          value={dashboard.pendingPayments}
          icon={FiCreditCard}
          hint={dashboard.pendingPayments > 0 ? 'Needs your follow-up' : 'All settled'}
          attention={dashboard.pendingPayments > 0}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Next up" description={loading ? undefined : dashboard.statusLabel}>
          <div className="divider divide-y">
            <div className="divider flex items-center gap-3 pb-3">
              <span className="chip-accent grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                <FiCalendar className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">Next booking</div>
                <div className="truncate text-sm font-medium">
                  {loading ? <span className="skeleton inline-block h-4 w-40" /> : dashboard.nextReservation}
                </div>
              </div>
            </div>
            <div className="divider flex items-center gap-3 pt-3">
              <span className="chip-accent grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                <FiShield className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">Waiver</div>
                <div className="text-sm font-medium">
                  {loading ? <span className="skeleton inline-block h-4 w-24" /> : dashboard.waiverStatus}
                </div>
              </div>
              {!loading && !waiverApproved ? (
                <Link to="/app/waiver" className="text-sm font-medium text-accent hover:underline">
                  {dashboard.waiverStatus === 'Not submitted' ? 'Sign now' : 'View'}
                </Link>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel title="Recent activity">
          <ActivityList
            items={dashboard.recentActivity}
            loading={loading}
            emptyText="No activity yet. Book your first game to get started."
          />
        </Panel>
      </div>

      <DashboardPostsPanel
        title="Announcements"
        subtitle="Updates and reminders from the Chill Shooters team."
      />
    </div>
  )
}
