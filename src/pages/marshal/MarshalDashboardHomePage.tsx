import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { ActionRow, DashboardHeader, Panel, StatTile } from '../../components/dashboard/DashboardParts'
import { apiGet } from '../../utils/apiClient'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { FiAlertTriangle, FiCalendar, FiShield, FiTool, FiZap } from 'react-icons/fi'
import { GiAk47 } from 'react-icons/gi'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'

type DashboardState = {
  // Today at a glance: games on today (and how many are running), players expected on the field,
  // and rented guns not yet checked back in.
  activeGames: number
  // Games from today on that aren't finished, and the day of the next one (YYYY-MM-DD).
  upcomingGames: number
  nextGameDate: string
  playersToday: number
  gunsOut: number
  // The marshal's work queue: today's games still to run, gear needing a check, damage reports
  // waiting for a fee decision, and repairs still open.
  gamesToday: number
  weaponsToCheck: number
  gearToCheck: number
  damageReports: number
  openRepairs: number
}

const defaultState: DashboardState = {
  activeGames: 0,
  upcomingGames: 0,
  nextGameDate: '',
  playersToday: 0,
  gunsOut: 0,
  gamesToday: 0,
  weaponsToCheck: 0,
  gearToCheck: 0,
  damageReports: 0,
  openRepairs: 0,
}

// Gear statuses that need a marshal (same as the Weapons and Gear badges in the sidebar).
const ATTENTION_QUERY = encodeURIComponent(JSON.stringify({ status: { $in: ['needs-check', 'maintenance', 'damaged'] }, source: { $ne: 'player' } }))
const countNeedingCheck = (collection: string) =>
  apiGet<{ total?: number }>(`/api/${collection}?q=${ATTENTION_QUERY}&limit=1&withTotal=1`).then((r) => Number(r?.total || 0)).catch(() => 0)

// When the next game is: running now, today, tomorrow, or its date ("Next: Nov 27").
function nextGameLabel(dateISO: string, running: number) {
  if (running > 0) return `${running} running`
  if (!dateISO) return 'None scheduled'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + 86_400_000))
  if (dateISO === today) return 'Today'
  if (dateISO === tomorrow) return 'Tomorrow'
  return `Next: ${new Date(`${dateISO}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
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
        const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
        const todayQuery = encodeURIComponent(JSON.stringify({ reservationDate: todayISO }))
        const [reservationsRes, rentalsRes, gameplayRes, weaponsToCheck, gearToCheck, reportsRes, repairsRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>(`/api/reservations?q=${todayQuery}&limit=200`),
          apiGet<{ ok: boolean; data: any[] }>('/api/rentals?status=out').catch(() => ({ ok: false, data: [] as any[] })),
          // Games from today on, plus any still running from an earlier day.
          apiGet<{ ok: boolean; data: any[] }>(`/api/gameplay?q=${encodeURIComponent(JSON.stringify({ $or: [{ Schedule: { $gte: todayISO } }, { Status: { $regex: '^ongo', $options: 'i' } }] }))}&limit=500`),
          countNeedingCheck('weapons'),
          countNeedingCheck('equipments'),
          apiGet<{ ok: boolean; data: any[] }>('/api/damage-reports?limit=200').catch(() => ({ ok: false, data: [] as any[] })),
          apiGet<{ ok: boolean; data: any[] }>('/api/repairs').catch(() => ({ ok: false, data: [] as any[] })),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const rentalsOut = Array.isArray(rentalsRes?.data) ? rentalsRes.data : []
        const gameplay = Array.isArray(gameplayRes?.data) ? gameplayRes.data : []

        const activeGames = gameplay.filter((item) => {
          // Games store their status as "Status".
          const status = String(item?.Status || item?.status || '').trim().toLowerCase()
          return status === 'active' || status === 'ongoing' || status === 'in_progress'
        }).length

        // Players expected on the field today: today's confirmed bookings.
        const playersToday = reservations
          .filter((item) => ['confirmed', 'approved'].includes(String(item?.reservationStatus || '').trim().toLowerCase()))
          .reduce((sum, item) => sum + (Number(item?.numberOfPlayers) || 0), 0)
        // Rented guns still out (any game), to check back in.
        const gunsOut = rentalsOut.filter((rental: any) => rental?.itemCollection === 'weapons').length

        // Upcoming: games from today on that haven't finished, and when the next one is.
        const upcoming = gameplay.filter((item) => {
          const status = String(item?.Status || item?.status || '').trim().toLowerCase()
          return String(item?.Schedule || '').slice(0, 10) >= todayISO && !/^(compl|arch|cancel)/.test(status)
        })
        const upcomingGames = upcoming.length
        const nextGameDate = upcoming.map((item) => String(item?.Schedule || '').slice(0, 10)).filter(Boolean).sort()[0] || ''
        // Today's games (Manila) that haven't finished yet.
        const gamesToday = gameplay.filter((item) => {
          const status = String(item?.Status || item?.status || '').trim().toLowerCase()
          return String(item?.Schedule || '').startsWith(todayISO) && !/^(compl|arch|cancel)/.test(status)
        }).length
        const damageReports = (reportsRes?.data || []).filter((report: any) => report?.status === 'reported').length
        const openRepairs = (repairsRes?.data || []).filter((repair: any) => repair?.status === 'in_progress').length

        if (active) {
          setStats({
            activeGames,
            upcomingGames,
            nextGameDate,
            playersToday,
            gunsOut,
            gamesToday,
            weaponsToCheck,
            gearToCheck,
            damageReports,
            openRepairs,
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

      {/* Same layout as the player and registrar dashboards: announcements in the main column, the
          calendar under the sidebar menu on desktop (under the announcements on phones), and on the
          right the weather, today's counts and the marshal's work queue. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <DashboardPostsPanel
            title="Announcements"
            subtitle="Updates and reminders from the Chill Shooters team."
            initialCount={3}
          />
          <div className="lg:hidden"><CapacityCalendar /></div>
        </div>

        {/* On desktop the side column stays in view while the announcements scroll (like the menu on the left). */}
        <aside className="no-scrollbar order-first space-y-3 lg:sticky lg:top-[96px] lg:order-none lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
          <WeatherAdvisoryWidget />

          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Upcoming" value={stats.upcomingGames} hint={nextGameLabel(stats.nextGameDate, stats.activeGames)} loading={loading} to="/app/games" />
            <StatTile compact label="Players" value={stats.playersToday} hint="Expected today" loading={loading} to="/app/counter?view=today" />
            <StatTile compact label="Guns out" value={stats.gunsOut} hint={stats.gunsOut > 0 ? 'To check in' : 'All back'} attention={stats.gunsOut > 0} loading={loading} to="/app/counter?view=out" />
          </div>

          {(() => {
            const queue = stats.gamesToday + stats.weaponsToCheck + stats.gearToCheck + stats.damageReports + stats.openRepairs
            return (
              <Panel
                compact
                title="Work queue"
                description={loading ? undefined : queue > 0 ? `${queue} item${queue === 1 ? '' : 's'} need you` : 'Nothing waiting right now'}
              >
                <div className="space-y-0.5">
                  <ActionRow to="/app/games" icon={FiCalendar} title="Today's games" description="Check in, group teams, FPS check" badge={loading ? undefined : stats.gamesToday} />
                  <ActionRow to="/app/admin/weapons" icon={GiAk47} title="Weapons to check" description="Flagged or damaged, before play" badge={loading ? undefined : stats.weaponsToCheck} />
                  <ActionRow to="/app/admin/equipment" icon={FiShield} title="Gear to check" description="Masks, vests and other gear in maintenance" badge={loading ? undefined : stats.gearToCheck} />
                  <ActionRow to="/app/admin/weapons?view=repairs" icon={FiAlertTriangle} title="Damage reports" description="Set the damage fee or waive it" badge={loading ? undefined : stats.damageReports} />
                  <ActionRow to="/app/admin/weapons?view=repairs" icon={FiTool} title="Repairs in progress" description="Gunsmith repairs still open" badge={loading ? undefined : stats.openRepairs} />
                </div>
              </Panel>
            )
          })()}
        </aside>
      </div>
    </div>
  )
}
