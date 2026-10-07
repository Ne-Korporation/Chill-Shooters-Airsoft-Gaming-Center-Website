import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { Card } from '../../components/ui/Card'
import { apiGet } from '../../utils/apiClient'
import { FiClipboard, FiShield, FiTool, FiTruck, FiZap } from 'react-icons/fi'

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
          const status = String(item?.status || '').trim().toLowerCase()
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

  const summaryCards = useMemo(
    () => [
      { label: 'Active games', value: stats.activeGames, tone: 'accent', icon: FiZap },
      { label: 'Reserved ops', value: stats.reservedGames, tone: 'success', icon: FiClipboard },
      { label: 'Equipment alerts', value: stats.equipmentAlerts, tone: 'danger', icon: FiTool },
      { label: 'Weapon checks', value: stats.weaponAlerts, tone: 'warning', icon: FiTruck },
      { label: 'Ready players', value: stats.playersReady, tone: 'muted', icon: FiShield },
    ],
    [stats],
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span>Marshal Operations</span>
        </div>
        <h1 className="text-3xl font-bold">Marshal Dashboard</h1>
        <p className="text-sm text-muted">Monitor live field activity, equipment readiness, and safety checks across active bookings.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map(({ label, value, tone, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
                <div
                  className={`mt-2 text-2xl font-bold ${
                    tone === 'accent'
                      ? 'text-accent'
                      : tone === 'success'
                        ? 'text-success'
                        : tone === 'danger'
                          ? 'text-danger'
                          : tone === 'warning'
                            ? 'text-gold'
                            : 'text-muted'
                  }`}
                >
                  {loading ? '…' : value}
                </div>
              </div>
              <div className="rounded-xl bg-white/5 p-2 text-accent">
                <Icon className="h-4 w-4" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted">Quick actions</div>
          <div className="space-y-3">
            <Link to="/app/games" className="block rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
              <div className="text-sm font-semibold">Manage active games</div>
              <div className="mt-1 text-xs text-muted">Open the game board, schedules, and live field status.</div>
            </Link>
            <Link to="/app/admin/equipment" className="block rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
              <div className="text-sm font-semibold">Check equipment readiness</div>
              <div className="mt-1 text-xs text-muted">Review maintenance issues and stock availability.</div>
            </Link>
            <Link to="/app/admin/weapons" className="block rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
              <div className="text-sm font-semibold">Weapon inspection queue</div>
              <div className="mt-1 text-xs text-muted">Flag or clear weapons needing inspection before play.</div>
            </Link>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted">Operational focus</div>
          <div className="space-y-3 text-sm text-muted">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="font-semibold text-text">Safety briefing</div>
              <div className="mt-1">Verify active squad readiness before each session starts and confirm field assignments.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="font-semibold text-text">Equipment checks</div>
              <div className="mt-1">Watch inventory and maintenance states so worn or damaged gear is removed before the next booking.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="font-semibold text-text">Player readiness</div>
              <div className="mt-1">Track verified players and confirm active rosters are aligned with upcoming games.</div>
            </div>
          </div>
        </Card>
      </div>

      <DashboardPostsPanel
        title="Dashboard posts"
        subtitle="Official updates, reminders, and notices shared by admin across the whole team."
      />
    </div>
  )
}
