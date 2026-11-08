import React, { useEffect, useState } from 'react'
import { useLiveRefresh } from '../../utils/liveUpdates'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { SplitShareDueCard } from '../../components/dashboard/SplitShareDueCard'
import { Link } from 'react-router-dom'
import { FiCalendar, FiPlus, FiShield } from 'react-icons/fi'
import { ActivityList, DashboardHeader, Panel, StatTile, type ActivityTone } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'


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
  // Up to three soonest confirmed bookings: a "date · slot" label and the location.
  upcoming: Array<{ id: string; label: string; location: string }>
  recentActivity: ActivityItem[]
}

const defaultState: DashboardState = {
  totalReservations: 0,
  upcomingReservations: 0,
  pendingPayments: 0,
  waiverStatus: 'Not submitted',
  statusLabel: 'Loading your dashboard…',
  statusTone: 'muted',
  upcoming: [],
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
  // Bumped when the data shown here changes on the server; re-runs the load below quietly.
  const [liveTick, setLiveTick] = useState(0)
  useLiveRefresh(['reservations', 'payments', 'waivers', 'accounts', 'content'], () => setLiveTick((tick) => tick + 1))

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      if (liveTick === 0) setLoading(true)

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

        const myWaivers = waivers.filter((waiver) => !waiver?.archived).filter((waiver) =>
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

        // The soonest confirmed booking from today on (game dates are YYYY-MM-DD, Manila time).
        const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
        const slotOrder = ['morning', 'afternoon', 'evening']
        const upcomingBookings = myReservations
          .filter((reservation) => {
            const status = normalize(reservation?.reservationStatus)
            const date = String(reservation?.reservationDate || reservation?.date || '')
            return (status === 'confirmed' || status === 'approved') && date >= todayISO
          })
          .sort((a, b) => (
            String(a.reservationDate || a.date || '').localeCompare(String(b.reservationDate || b.date || ''))
            || slotOrder.indexOf(normalize(a.reservationTime)) - slotOrder.indexOf(normalize(b.reservationTime))
          ))
          .slice(0, 3)

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
          upcoming: upcomingBookings.map((reservation, index) => ({
            id: String(reservation.id || reservation._id || index),
            label: [
              formatReservationDate(reservation.reservationDate || reservation.date || reservation.createdAtISO),
              reservation.reservationTime
                ? String(reservation.reservationTime).charAt(0).toUpperCase() + String(reservation.reservationTime).slice(1)
                : 'Time pending',
            ].join(' · '),
            location: String(reservation.locationName || reservation.location || ''),
          })),
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
  }, [user?.id, liveTick])

  const firstName = String(user?.name || 'player').trim().split(/\s+/)[0]
  const waiverApproved = dashboard.waiverStatus === 'Approved'

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Dashboard"
        title={user?.firstLogin ? `Welcome, ${firstName}` : `Welcome back, ${firstName}`}
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

      {/* Desktop: announcements and the calendar in the main column, the player's summary on the right.
          Phones: the summary (payments due, waiver) comes first, then announcements, then recent activity. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <DashboardPostsPanel
            title="Announcements"
            subtitle="Updates and reminders from the Chill Shooters team."
            initialCount={3}
          />
          {/* On desktop the calendar sits under the sidebar menu instead. */}
          <div className="lg:hidden"><CapacityCalendar /></div>
        </div>

        <aside className="order-first space-y-3 lg:order-none lg:col-start-2 lg:row-start-1">
          {/* Shown only while the player owes a split payment share. */}
          <SplitShareDueCard />
          <WeatherAdvisoryWidget />
          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Bookings" value={dashboard.totalReservations} hint="All time" loading={loading} />
            <StatTile compact label="Upcoming" value={dashboard.upcomingReservations} hint="Confirmed" loading={loading} />
            <StatTile
              compact
              label="To pay"
              value={dashboard.pendingPayments}
              hint={dashboard.pendingPayments > 0 ? 'Follow up' : 'Settled'}
              attention={dashboard.pendingPayments > 0}
              loading={loading}
            />
          </div>

          <Panel compact title="Upcoming reservations">
            <div className="divider divide-y">
              {loading ? (
                <div className="space-y-2 py-1">
                  <span className="skeleton block h-3 w-40" />
                  <span className="skeleton block h-3 w-32" />
                </div>
              ) : dashboard.upcoming.length === 0 ? (
                <div className="py-1 text-xs text-muted">
                  No upcoming bookings. <Link to="/app/reservations" className="font-medium text-accent hover:underline">Book a game</Link>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {dashboard.upcoming.map((booking) => (
                    <Link key={booking.id} to="/app/my-reservations" className="hover-row -mx-1 flex items-center gap-2 rounded-lg px-1 py-1">
                      <span className="chip-accent grid h-7 w-7 shrink-0 place-items-center rounded-lg">
                        <FiCalendar className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{booking.label}</div>
                        {booking.location ? <div className="truncate text-[11px] text-muted">{booking.location}</div> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {/* Only shown while the waiver still needs the player's attention. */}
              {!loading && !waiverApproved ? (
              <div className="divider mt-2 flex items-center gap-2 pt-2">
                <span className="chip-accent grid h-7 w-7 shrink-0 place-items-center rounded-lg">
                  <FiShield className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-muted">Waiver</div>
                  <div className="text-xs font-medium">{dashboard.waiverStatus}</div>
                </div>
                <Link to="/app/waiver" className="text-xs font-medium text-accent hover:underline">
                  {dashboard.waiverStatus === 'Not submitted' ? 'Sign now' : 'View'}
                </Link>
              </div>
              ) : null}
            </div>
          </Panel>
        </aside>

        <div className="lg:col-start-2 lg:row-start-2">
          <Panel compact title="Recent activity">
            <ActivityList
              compact
              items={dashboard.recentActivity}
              loading={loading}
              emptyText="No activity yet. Book your first game to get started."
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}
