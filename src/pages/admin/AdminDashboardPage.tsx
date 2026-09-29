import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { apiGet } from '../../utils/apiClient'

type ActivityTone = 'accent' | 'success' | 'danger' | 'muted'

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
  recentActivity: ActivityItem[]
}

const defaultState: DashboardState = {
  reservations: 0,
  players: 0,
  payments: 0,
  pendingApprovals: 0,
  equipmentAlerts: 0,
  reviewQueue: 0,
  recentActivity: [],
}

const StatCard = ({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'accent' | 'success' | 'danger' | 'muted'
}) => {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-muted'

  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</div>
    </Card>
  )
}

const QuickAction = ({
  title,
  subtitle,
  href,
}: {
  title: string
  subtitle: string
  href: string
}) => {
  return (
    <Link to={href} className="block">
      <Card className="p-4 transition hover:bg-white/5">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted">{subtitle}</div>
        <div className="mt-3 flex h-9 items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3">
          <div className="text-[11px] text-muted">Open module</div>
          <div className="h-2.5 w-2.5 rounded-full bg-accent" />
        </div>
      </Card>
    </Link>
  )
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
        const [reservationsRes, paymentsRes, usersRes, equipmentRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const users = Array.isArray(usersRes?.data) ? usersRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []

        const pendingApprovals = reservations.filter((reservation) => {
          const status = String(reservation?.reservationStatus || '').trim().toLowerCase()
          return status === 'pending' || status === 'needs review' || status === 'needs_review' || status === 'review'
        }).length

        const equipmentAlerts = equipment.filter((item) => {
          const status = String(item?.status || '').trim().toLowerCase()
          const qty = Number(item?.qty ?? 0)
          return status === 'maintenance' || qty <= 1
        }).length

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
          equipmentAlerts,
          reviewQueue,
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-sm text-muted">Command Center Overview with live operational data.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Reservations" value={loading ? '…' : String(dashboard.reservations)} tone="accent" />
        <StatCard label="Players" value={loading ? '…' : String(dashboard.players)} tone="success" />
        <StatCard label="Payments" value={loading ? '…' : String(dashboard.payments)} tone="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Operational Snapshot</div>
                <div className="mt-2 text-lg font-semibold">Live workflow status</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                <div className="text-[11px] text-muted">System</div>
                <div className="mt-1 text-sm font-bold text-accent">Nominal</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Card className="bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">Pending approvals</div>
                <div className="mt-2 text-xl font-bold text-accent">{loading ? '…' : dashboard.pendingApprovals}</div>
              </Card>
              <Card className="bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">Equipment alerts</div>
                <div className="mt-2 text-xl font-bold text-danger">{loading ? '…' : dashboard.equipmentAlerts}</div>
              </Card>
              <Card className="bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">Review queue</div>
                <div className="mt-2 text-xl font-bold text-success">{loading ? '…' : dashboard.reviewQueue}</div>
              </Card>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Recent Activity</div>
            <div className="mt-2 text-sm text-muted">
              The latest reservation and payment updates from the system.
            </div>
            <div className="mt-4 space-y-2">
              {dashboard.recentActivity.length === 0 && !loading ? (
                <div className="rounded-xl border border-white/5 bg-white/5/60 px-3 py-2 text-sm text-muted">
                  No recent activity found yet.
                </div>
              ) : (
                dashboard.recentActivity.map((row, idx) => (
                  <div
                    key={`${row.title}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5/60 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-semibold">{row.title}</div>
                      <div className="text-xs text-muted">{row.subtitle}</div>
                    </div>
                    <div className={`text-xs font-semibold ${row.tone === 'accent' ? 'text-accent' : row.tone === 'success' ? 'text-success' : row.tone === 'danger' ? 'text-danger' : 'text-muted'}`}>
                      {row.meta}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Quick Actions</div>
            <div className="mt-2 text-sm text-muted">Jump to the admin modules that match your day-to-day workflow.</div>
          </Card>

          <div className="space-y-3">
            <QuickAction
              title="Reservation Management"
              subtitle="Approve, reject, and reschedule bookings from one place."
              href="/app/admin/reservation-management"
            />
            <QuickAction
              title="Users"
              subtitle="Review players and manage access for staff and players."
              href="/app/admin/players"
            />
            <QuickAction
              title="Partnerships"
              subtitle="Track sponsors, schools, and community collaborations."
              href="/app/admin/partnerships"
            />
            <QuickAction
              title="Audit Logs"
              subtitle="Trace recent administrative activity and changes."
              href="/app/admin/audit-logs"
            />
          </div>
        </div>
      </div>
    </div>
  )
}


