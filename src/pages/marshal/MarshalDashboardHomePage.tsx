import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { DashboardHeader, StatTile } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { FiZap } from 'react-icons/fi'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'

type DashboardState = {
  activeGames: number
  reservedGames: number
  playersReady: number
}

const defaultState: DashboardState = {
  activeGames: 0,
  reservedGames: 0,
  playersReady: 0,
}

export function MarshalDashboardHomePage() {
  const [stats, setStats] = useState<DashboardState>(defaultState)
  const [loading, setLoading] = useState(true)

  // Bumped every few seconds so new bookings and games show without reloading.
  const [refreshTick, setRefreshTick] = useState(0)
  useAutoRefresh(() => setRefreshTick((tick) => tick + 1))

  useEffect(() => {
    let active = true
    // Background refreshes keep what's on screen instead of showing loading or errors.
    const silent = refreshTick > 0

    const load = async () => {
      if (!silent) setLoading(true)
      try {
        const [reservationsRes, usersRes, gameplayRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500'),
          apiGet<{ ok: boolean; data: any[] }>('/api/gameplay?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const users = Array.isArray(usersRes?.data) ? usersRes.data : []
        const gameplay = Array.isArray(gameplayRes?.data) ? gameplayRes.data : []

        const activeGames = gameplay.filter((item) => {
          // Games store their status as "Status".
          const status = String(item?.Status || item?.status || '').trim().toLowerCase()
          return status === 'active' || status === 'ongoing' || status === 'in_progress'
        }).length

        const reservedGames = reservations.filter((item) => {
          const status = String(item?.reservationStatus || '').trim().toLowerCase()
          return status === 'approved' || status === 'confirmed' || status === 'paid'
        }).length

        const playersReady = users.filter((user) => {
          const role = String(user?.role || '').trim().toLowerCase()
          const verified = String(user?.identityVerificationStatus || '').trim().toLowerCase()
          return role === 'user' && (verified === 'verified' || verified === 'active' || verified === 'approved')
        }).length

        if (active) {
          setStats({
            activeGames,
            reservedGames,
            playersReady,
          })
        }
      } catch (error: any) {
        if (active && !silent) {
          toast.error(String(error?.message || error))
          setStats(defaultState)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { active = false }
  }, [refreshTick])

  const { user } = useAuth()
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0]

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        description="Live games, gear readiness, and safety checks for today's sessions."
        actions={
          <Link to="/app/games" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110">
            <FiZap /> Open game board
          </Link>
        }
      />

      {/* Same layout as the admin and registrar dashboards: the capacity calendar in the main
          column (view only; games for a cause are set by the admin) and one column beside it:
          the weather, today's counts, then announcements. Gear and weapon alerts are counts on
          the Weapons and Gear items in the sidebar, with the before-each-session checklist. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <CapacityCalendar
            title="Game Capacity"
            subtitle="Spots booked for each weekend's open games. Click a day for details."
          />
        </div>

        <aside className="space-y-3">
          <WeatherAdvisoryWidget />

          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Active" value={stats.activeGames} hint="In progress" loading={loading} />
            <StatTile compact label="Reserved" value={stats.reservedGames} hint="Approved/paid" loading={loading} />
            <StatTile compact label="Ready" value={stats.playersReady} hint="ID verified" loading={loading} />
          </div>

          <DashboardPostsPanel
            title="Announcements"
            initialCount={3}
          />
        </aside>
      </div>
    </div>
  )
}
