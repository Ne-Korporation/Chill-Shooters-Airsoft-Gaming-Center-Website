import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiBell, FiCloudRain, FiMail, FiRefreshCw, FiSun } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type SlotForecast = {
  slot: string
  available: boolean
  severe: boolean
  rainy?: boolean
  reasons: string[]
  summary: string
  rainChancePercent?: number
  windKph?: number
  tempC?: number
}

type Advisory = {
  id: string
  source: 'auto' | 'manual'
  locationId: string
  date: string
  slot: string | null
  message: string
  reservationCount: number
  recipientCount: number
  createdAtISO: string
  createdBy?: { actorEmail?: string } | null
}

const LOCATIONS = [
  { id: 'salawag', name: 'Chill Shooters (Salawag)' },
  { id: 'langkaan', name: 'Chill Shooters (Langkaan)' },
  { id: 'binan', name: 'BBC Airsoft Binan Laguna' },
]

function manilaDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + offsetDays * 86_400_000))
}

const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-accent/40 [&>option]:bg-background'

export function AdminWeatherPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiCloudRain /> Weather advisories</h1>
        <p className="mt-1 text-sm text-muted">
          Sent automatically: the system checks the forecast every hour and warns players booked on a rainy, stormy or windy slot.
        </p>
      </div>
      <WeatherPanel />
    </div>
  )
}

// Weather advisories are automatic (server/utils/weather.js): every hour the forecast for each booked
// slot is checked; players on a rainy, stormy or windy slot get an in-app notice that follows the
// forecast, and an email the day before. This panel shows that it's running, lets admins run the
// check now, view the forecast, and see what was sent. Shown in the weather pop-up by the bell.
export function WeatherPanel() {
  const { user } = useAuth()
  const slotHours = useSlotHours()
  const [configured, setConfigured] = useState(true)
  const [location, setLocation] = useState(LOCATIONS[0].id)
  const [date, setDate] = useState(manilaDate(1))
  const [forecast, setForecast] = useState<SlotForecast[]>([])
  const [forecastError, setForecastError] = useState('')
  const [advisories, setAdvisories] = useState<Advisory[]>([])
  const [checking, setChecking] = useState(false)
  const [showForecast, setShowForecast] = useState(false)
  const isAdmin = user?.role === 'admin'
  const locationName = LOCATIONS.find((l) => l.id === location)?.name

  const loadAdvisories = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; configured: boolean; data: Advisory[] }>('/api/weather-advisories')
      setAdvisories(res.data || [])
      setConfigured(res.configured)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load advisories')
    }
  }, [])

  useEffect(() => {
    void loadAdvisories()
  }, [loadAdvisories])

  useEffect(() => {
    if (!showForecast) return
    let cancelled = false
    setForecast([])
    setForecastError('')
    apiGet<{ ok: boolean; configured: boolean; data: SlotForecast[] }>(`/api/weather/forecast?location=${location}&date=${date}`)
      .then((res) => {
        if (cancelled) return
        setConfigured(res.configured)
        setForecast(res.data || [])
      })
      .catch((err: any) => {
        if (!cancelled) setForecastError(err?.message || 'Unable to load the forecast')
      })
    return () => {
      cancelled = true
    }
  }, [location, date, showForecast])

  // Runs the hourly check right away (forecast outlook + tomorrow's emails).
  const checkNow = async () => {
    setChecking(true)
    try {
      const res = await apiPost<{ ok: boolean; data: { advisories?: number; skipped?: string } }>('/api/weather-advisories/check', {})
      const sent = Number(res.data?.advisories || 0)
      toast.success(res.data?.skipped === 'not configured' ? 'Weather checks are off: the forecast key is missing.' : sent > 0 ? `Checked. ${sent} new advisor${sent === 1 ? 'y' : 'ies'} sent.` : 'Checked. No new advisories needed.')
      void loadAdvisories()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to run the check')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* How the automatic advisories work. */}
      {configured ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Automatic advisories are on
              </div>
              <p className="mt-1 text-xs text-muted">Every hour the system checks the forecast for every booked game. No one needs to send them.</p>
            </div>
            {isAdmin ? (
              <Button size="sm" variant="ghost" disabled={checking} onClick={checkNow}>
                <FiRefreshCw className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
              </Button>
            ) : null}
          </div>
          <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <li className="flex gap-2 rounded-xl bg-white/5 p-3">
              <FiBell className="mt-0.5 shrink-0 text-accent" />
              <span><span className="font-semibold">In-app notice</span> to players booked on a rainy, stormy or windy slot, up to 5 days ahead. It updates when the forecast changes and goes away if it clears.</span>
            </li>
            <li className="flex gap-2 rounded-xl bg-white/5 p-3">
              <FiMail className="mt-0.5 shrink-0 text-accent" />
              <span><span className="font-semibold">Email the day before</span> the game when rain, thunderstorms or strong wind are likely.</span>
            </li>
          </ul>
        </Card>
      ) : (
        <div className="rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
          Automatic weather advisories are off: add <code>OPENWEATHER_API_KEY</code> to the server environment.
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 text-xs uppercase tracking-widest text-muted">Check the forecast</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-xs text-muted">
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={selectClass + ' mt-1'}>
              {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="min-w-[160px] text-xs text-muted">
            Date
            <Input type="date" value={date} min={manilaDate(0)} max={manilaDate(5)} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </label>
          <Button type="button" variant="ghost" onClick={() => setShowForecast(true)}>
            <FiSun /> View forecast
          </Button>
        </div>
      </Card>

      {showForecast ? (
        <Modal eyebrow="Forecast" title={`${locationName} · ${date}`} onClose={() => setShowForecast(false)} size="xl">
          {forecastError ? <div className="text-sm text-danger">{forecastError}</div> : null}
          <div className="grid gap-3 md:grid-cols-3">
            {forecast.map((entry) => (
              <div key={entry.slot} className={['rounded-2xl border p-3', entry.severe || entry.rainy ? 'border-danger/30 bg-danger/10' : 'border-white/10 bg-white/5'].join(' ')}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold capitalize">{entry.slot} <span className="text-xs font-normal normal-case text-muted">{formatSlotRange(slotHours, entry.slot)}</span></div>
                  {entry.severe || entry.rainy ? <span className="text-[10px] font-bold uppercase tracking-widest text-danger">Advisory</span> : null}
                </div>
                <div className="mt-2 text-xs text-muted">{entry.summary}</div>
                {entry.available ? (
                  <div className="mt-2 text-xs text-muted">Wind up to {entry.windKph} km/h</div>
                ) : null}
                {entry.reasons.length ? <div className="mt-2 text-xs text-danger">{entry.reasons.join('; ')}</div> : null}
              </div>
            ))}
            {configured && !forecastError && forecast.length === 0 ? <div className="text-sm text-muted">Loading…</div> : null}
          </div>
          <p className="mt-3 text-[11px] text-muted">Forecasts cover the next 5 days. Slot hours are set on the Reservations page.</p>
        </Modal>
      ) : null}

      <Card className="p-4">
        <div className="mb-3 text-xs uppercase tracking-widest text-muted">Sent advisories</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="py-2 pr-4">Sent</th>
                <th className="py-2 pr-4">Game</th>
                <th className="py-2 pr-4">Sent by</th>
                <th className="py-2 pr-4">Message</th>
                <th className="py-2 text-right">Players</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {advisories.length === 0 ? (
                <tr><td colSpan={5} className="py-3 text-muted">No advisories yet. They're sent automatically when bad weather is forecast for a booked game.</td></tr>
              ) : advisories.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-xs text-muted">{new Date(a.createdAtISO).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-xs">{a.date} · {a.slot || 'all slots'} · {LOCATIONS.find((l) => l.id === a.locationId)?.name || a.locationId}</td>
                  <td className="py-2 pr-4 text-xs">{a.source === 'auto' ? 'System (automatic)' : a.createdBy?.actorEmail || 'Staff'}</td>
                  <td className="py-2 pr-4 text-xs text-muted">{a.message}</td>
                  <td className="py-2 text-right">{a.recipientCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
