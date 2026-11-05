import React, { useEffect, useState } from 'react'
import { FiBarChart2, FiCalendar, FiClock, FiCreditCard, FiLogOut, FiShield, FiShoppingBag, FiTool, FiUsers } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { PaymentCompletePanel } from '../../components/dashboard/PaymentCompletePanel'
import { ActionRow, ActivityList, DashboardHeader, Panel, StatTile, type ActivityTone } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { equipmentAlerts } from '../../utils/inventoryModels'


type ActivityItem = {
  title: string
  subtitle: string
  meta: string
  tone: ActivityTone
}

type DashboardState = {
  reservations: number
  players: number
  payments: number
  pendingApprovals: number
  equipmentAlerts: number
  reviewQueue: number
  waiversToReview: number
  recentActivity: ActivityItem[]
}

const defaultState: DashboardState = {
  reservations: 0,
  players: 0,
  payments: 0,
  pendingApprovals: 0,
  equipmentAlerts: 0,
  reviewQueue: 0,
  waiversToReview: 0,
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

export function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardState>(defaultState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [reservationsRes, paymentsRes, usersRes, equipmentRes, waiversRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200').catch(() => ({ ok: false, data: [] as any[] })),
        ])
        const waiversToReview = (Array.isArray(waiversRes?.data) ? waiversRes.data : []).filter((waiver) =>
          ['pending', 'review', 'submitted'].includes(String(waiver?.status || 'pending').trim().toLowerCase())).length

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const users = Array.isArray(usersRes?.data) ? usersRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []

        const pendingApprovals = reservations.filter((reservation) => {
          const status = String(reservation?.reservationStatus || '').trim().toLowerCase()
          return status === 'pending' || status === 'needs review' || status === 'needs_review' || status === 'review'
        }).length

        const equipmentAlertCount = equipmentAlerts(equipment).count

        const reviewQueue = payments.filter((payment) => {
          const status = String(payment?.paymentStatus || payment?.status || '').trim().toLowerCase()
          return status === 'review' || status === 'pending'
        }).length

        const activityRows: ActivityItem[] = []
        reservations
          .slice()
          .sort((a, b) => (b.updatedAtISO || b.createdAtISO || '').localeCompare(a.updatedAtISO || a.createdAtISO || ''))
          .slice(0, 2)
          .forEach((reservation) => {
            const status = String(reservation?.reservationStatus || 'pending')
            const id = reservation?.id || 'unknown'
            const player = reservation?.userName || reservation?.player || reservation?.userId || 'Player'
            activityRows.push({
              title: `${status === 'confirmed' ? 'Confirmed' : 'Updated'} reservation ${id}`,
              subtitle: player,
              meta: formatRelativeTime(reservation?.updatedAtISO || reservation?.createdAtISO),
              tone: status === 'confirmed' ? 'success' : 'accent',
            })
          })

        payments
          .slice()
          .sort((a, b) => (b.updatedAtISO || b.createdAtISO || '').localeCompare(a.updatedAtISO || a.createdAtISO || ''))
          .slice(0, 1)
          .forEach((payment) => {
            const paymentStatus = String(payment?.paymentStatus || payment?.status || 'pending')
            activityRows.push({
              title: `Payment ${paymentStatus}`,
              subtitle: payment?.transactionReference || payment?.refNo || payment?.id || 'Receipt pending',
              meta: formatRelativeTime(payment?.updatedAtISO || payment?.createdAtISO),
              tone: paymentStatus === 'paid' || paymentStatus === 'confirmed' ? 'success' : 'danger',
            })
          })

        const nextState: DashboardState = {
          reservations: reservations.length,
          players: users.filter((user) => String(user?.role || '').trim().toLowerCase() === 'user').length || users.length,
          payments: payments.length,
          pendingApprovals,
          equipmentAlerts: equipmentAlertCount,
          reviewQueue,
          waiversToReview,
          recentActivity: activityRows.slice(0, 3),
        }

        if (isMounted) {
          setDashboard(nextState)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Unable to load dashboard data')
          setDashboard(defaultState)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      isMounted = false
    }
  }, [])

  const { user } = useAuth()
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0]
  const attentionCount = dashboard.pendingApprovals + dashboard.reviewQueue + dashboard.waiversToReview + dashboard.equipmentAlerts

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        description="What's happening across reservations, players, and payments."
        actions={
          <Link to="/app/admin/reservations" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110">
            <FiCalendar /> Reservations
          </Link>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-danger bg-[rgba(214,69,69,0.08)] px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* Same layout as the player dashboard: announcements in the main column, a compact summary on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DashboardPostsPanel
          canManage
          title="Announcements"
          subtitle="Posts here appear on every dashboard: players, marshals, and registrars."
          beforePosts={
            <CapacityCalendar
              compact
              editable
              title="Public game capacity"
              subtitle="Spots booked for each weekend's open games. Click a day to make it a game for a cause."
            />
          }
        />

        <aside className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Bookings" value={dashboard.reservations} hint="All" loading={loading} />
            <StatTile compact label="Players" value={dashboard.players} hint="Accounts" loading={loading} />
            <StatTile compact label="Payments" value={dashboard.payments} hint="Submitted" loading={loading} />
          </div>

          <Panel
            compact
            title="Needs attention"
            description={loading ? undefined : attentionCount > 0 ? `${attentionCount} items waiting on you` : 'All caught up'}
          >
            <div className="space-y-0.5">
              <ActionRow
                to="/app/admin/reservations"
                icon={FiClock}
                title="Reservations to approve"
                description={dashboard.pendingApprovals > 0 ? 'Pending or flagged for review' : 'Nothing pending'}
                badge={loading ? undefined : dashboard.pendingApprovals}
              />
              <ActionRow
                to="/app/admin/payments"
                icon={FiCreditCard}
                title="Payments to review"
                description={dashboard.reviewQueue > 0 ? 'Proofs waiting for verification' : 'Nothing pending'}
                badge={loading ? undefined : dashboard.reviewQueue}
              />
              <ActionRow
                to="/app/admin/waivers"
                icon={FiShield}
                title="Waivers to review"
                description={dashboard.waiversToReview > 0 ? 'Submitted waivers waiting for approval' : 'Nothing pending'}
                badge={loading ? undefined : dashboard.waiversToReview}
              />
              <ActionRow
                to="/app/admin/equipment"
                icon={FiTool}
                title="Gear alerts"
                description={dashboard.equipmentAlerts > 0 ? 'Low stock or in maintenance' : 'All gear available'}
                badge={loading ? undefined : dashboard.equipmentAlerts}
              />
            </div>
          </Panel>

          <PaymentCompletePanel />

          <Panel compact title="Shortcuts">
            <div className="space-y-0.5">
              <ActionRow to="/app/counter" icon={FiShoppingBag} title="Counter" description="Balances and extra charges at the field" />
              <ActionRow to="/app/walk-ins" icon={FiShoppingBag} title="Walk-ins" description="Register walk-ins for weekend public games" />
              <ActionRow to="/app/rentals" icon={FiLogOut} title="Rental check-out" description="Issue and return gear for today's games" />
              <ActionRow to="/app/admin/player-management" icon={FiUsers} title="Players & staff" description="Accounts, ID checks, and staff access" />
              <ActionRow to="/app/admin/reports" icon={FiBarChart2} title="Reports" description="Sales, bookings, rentals, and penalties" />
            </div>
          </Panel>

          <Panel compact title="Recent activity">
            <ActivityList compact items={dashboard.recentActivity} loading={loading} emptyText="No recent activity yet." />
          </Panel>
        </aside>
      </div>
    </div>
  )
}
