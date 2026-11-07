import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { ActionRow, DashboardHeader, Panel, StatTile } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { FiCheckCircle, FiTool, FiZap } from 'react-icons/fi'
import { GiAk47 } from 'react-icons/gi'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'

type DashboardState = {
  activeGames: number
  reservedGames: number
  equipmentAlerts: number
  weaponAlerts: number
  playersReady: number
}

const defaultState: DashboardState = {
  activeGames: 0,
  reservedGames: 0,
  equipmentAlerts: 0,
  weaponAlerts: 0,
  playersReady: 0,
}

export function MarshalDashboardHomePage() {
  const [stats, setStats] = useState<DashboardState>(defaultState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      try {
        const [reservationsRes, equipmentRes, weaponsRes, usersRes, gameplayRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500'),
          apiGet<{ ok: boolean; data: any[] }>('/api/gameplay?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []
        const weapons = Array.isArray(weaponsRes?.data) ? weaponsRes.data : []
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

        const equipmentAlerts = equipment.filter((item) => {
          const status = String(item?.status || '').trim().toLowerCase()
          return status === 'maintenance' || Number(item?.qty ?? 0) <= 1
        }).length

        const weaponAlerts = weapons.filter((item) => {
          const status = String(item?.status || '').trim().toLowerCase()
          return status === 'needs-check' || status === 'maintenance'
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
            equipmentAlerts,
            weaponAlerts,
            playersReady,
          })
        }
      } catch (error: any) {
        if (active) {
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
  }, [])

  const { user } = useAuth()
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0]
  const checklist = [
    { title: 'Safety briefing', detail: 'Confirm squad readiness and field assignments before each session.' },
    { title: 'Gear check', detail: 'Pull worn or damaged gear before the next booking.' },
    { title: 'Player roster', detail: 'Match verified players against upcoming games.' },
  ]

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
          announcements first, then the counts and what needs attention. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <CapacityCalendar
            title="Game Capacity"
            subtitle="Spots booked for each weekend's open games. Click a day for details."
          />
        </div>

        <aside className="space-y-3">
          <WeatherAdvisoryWidget />
          <DashboardPostsPanel
            title="Announcements"
            subtitle="Updates and reminders from the admin team."
            initialCount={3}
          />

          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Active" value={stats.activeGames} hint="In progress" loading={loading} />
            <StatTile compact label="Reserved" value={stats.reservedGames} hint="Approved/paid" loading={loading} />
            <StatTile compact label="Ready" value={stats.playersReady} hint="ID verified" loading={loading} />
          </div>

          <Panel
            compact
            title="Needs attention"
            description={
              loading
                ? undefined
                : stats.equipmentAlerts + stats.weaponAlerts > 0
                  ? 'Check these before the next session'
                  : 'All gear is ready'
            }
          >
            <div className="space-y-0.5">
              <ActionRow
                to="/app/admin/equipment"
                icon={FiTool}
                title="Gear alerts"
                description="Low stock or in maintenance"
                badge={loading ? undefined : stats.equipmentAlerts}
              />
              <ActionRow
                to="/app/admin/weapons"
                icon={GiAk47}
                title="Weapon inspections"
                description="Flag or clear weapons before play"
                badge={loading ? undefined : stats.weaponAlerts}
              />
            </div>
            {/* The session checklist, under the alerts so the side column stays about as tall as the calendar. */}
            <div className="divider mt-2 border-t pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Before each session</div>
              <ul className="space-y-2.5">
                {checklist.map((item) => (
                  <li key={item.title} className="flex gap-2">
                    <FiCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    <div>
                      <div className="text-xs font-medium">{item.title}</div>
                      <div className="text-[11px] text-muted">{item.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
