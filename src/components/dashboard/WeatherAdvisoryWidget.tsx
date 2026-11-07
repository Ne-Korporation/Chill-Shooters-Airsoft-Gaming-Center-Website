import React, { useCallback, useEffect, useState } from 'react'
import { FiCloudRain, FiSun } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { apiGet } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { WeatherPanel } from '../../pages/admin/AdminWeatherPage'

type CurrentAdvisory = {
  id: string
  source: 'auto' | 'manual'
  locationId: string
  locationName: string
  date: string
  slot: string | null
  title: string
  message: string
  createdAtISO: string
  mine: boolean
}

const REFRESH_MS = 10 * 60_000

function dayLabel(dateISO: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + 86_400_000))
  if (dateISO === today) return 'Today'
  if (dateISO === tomorrow) return 'Tomorrow'
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

// Dashboard widget on every account: weather advisories for today and the coming days. The
// server checks the forecast for booked slots automatically the day before each game; staff can
// also send one from here.
export function WeatherAdvisoryWidget() {
  const { user } = useAuth()
  const isStaff = user?.role === 'admin' || user?.role === 'registrar' || user?.role === 'marshal'
  const [advisories, setAdvisories] = useState<CurrentAdvisory[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: CurrentAdvisory[] }>('/api/weather-advisories/current')
      setAdvisories(Array.isArray(res?.data) ? res.data : [])
    } catch {
      // Keep whatever was shown; the widget is informational.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  // Games the viewer is booked on come first.
  const sorted = [...advisories].sort((a, b) => Number(b.mine) - Number(a.mine))

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <FiCloudRain className="text-gold" /> Weather advisories
        </div>
        {isStaff ? (
          <button type="button" onClick={() => setManageOpen(true)} className="text-[11px] font-semibold text-accent hover:underline">
            Forecast &amp; send
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 text-xs text-muted">Checking advisories…</div>
      ) : sorted.length === 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted">
          <FiSun className="mt-0.5 shrink-0 text-gold" />
          <span>No weather advisories for upcoming games. We check the forecast the day before every game and post here if rain, thunderstorms, or strong wind are likely.</span>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {sorted.map((a) => (
            <li
              key={a.id}
              className={['rounded-xl border px-3 py-2', a.mine ? 'border-warning/40 bg-warning/10' : 'border-white/10 bg-white/5'].join(' ')}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold">
                <span className={a.mine ? 'text-warning' : 'text-text'}>
                  {dayLabel(a.date)} · {a.slot ? capitalize(a.slot) : 'All slots'}
                </span>
                {a.mine ? <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warning">Your game</span> : null}
              </div>
              <div className="text-[11px] text-muted">{a.locationName}</div>
              <p className="mt-1 text-xs text-text">{a.message}</p>
            </li>
          ))}
        </ul>
      )}

      {manageOpen ? (
        <Modal
          eyebrow="Weather"
          title="Weather advisories"
          onClose={() => {
            setManageOpen(false)
            void load()
          }}
          size="xl"
        >
          <WeatherPanel />
        </Modal>
      ) : null}
    </Card>
  )
}
