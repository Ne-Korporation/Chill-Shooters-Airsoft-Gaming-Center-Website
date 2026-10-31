import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCloudRain } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type SlotForecast = {
  slot: string
  available: boolean
  severe: boolean
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
  { id: 'salawag', name: 'Delta Stronghold (Salawag)' },
  { id: 'langkaan', name: 'Delta Stronghold (Langkaan)' },
  { id: 'binan', name: 'LOMA Binan Laguna' },
]

function manilaDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + offsetDays * 86_400_000))
}

const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-accent/40 [&>option]:bg-background'

export function AdminWeatherPage() {
  const { user } = useAuth()
  const slotHours = useSlotHours()
  const [configured, setConfigured] = useState(true)
  const [location, setLocation] = useState(LOCATIONS[0].id)
  const [date, setDate] = useState(manilaDate(1))
  const [forecast, setForecast] = useState<SlotForecast[]>([])
  const [forecastError, setForecastError] = useState('')
  const [advisories, setAdvisories] = useState<Advisory[]>([])
  const [slot, setSlot] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const canSend = user?.role === 'admin' || user?.role === 'registrar'

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
    let cancelled = false
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
  }, [location, date])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    setSending(true)
    try {
      const res = await apiPost<{ ok: boolean; data: Advisory }>('/api/weather-advisories', { locationId: location, date, slot, message })
      toast.success(`Advisory sent to ${res.data.recipientCount} player(s) on ${res.data.reservationCount} booking(s).`)
      setMessage('')
      void loadAdvisories()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to send the advisory')
    } finally {
      setSending(false)
    }
  }

  const fillFromForecast = (entry: SlotForecast) => {
    setSlot(entry.slot)
    setMessage(`The forecast for ${LOCATIONS.find((l) => l.id === location)?.name} on ${date} (${entry.slot}) shows ${entry.reasons.join(' and ') || entry.summary}. We play rain or shine unless the marshals stop play for safety. If weather stops you from coming, contact us and staff can move your booking and payment to another date.`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiCloudRain /> Weather advisories</h1>
        <p className="mt-1 text-sm text-muted">
          The day before each game the system checks the forecast for every booked slot and emails players when it shows thunderstorms,
          likely heavy rain, or strong wind. You can also send an advisory yourself.
        </p>
      </div>

      {!configured ? (
        <div className="rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
          Automatic forecasts are off: add <code>OPENWEATHER_API_KEY</code> to the server environment. Manual advisories still work.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr,420px]">
        <Card className="p-4">
          <div className="mb-3 text-xs uppercase tracking-widest text-muted">Forecast</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={selectClass}>
              {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <Input type="date" value={date} min={manilaDate(0)} max={manilaDate(5)} onChange={(e) => setDate(e.target.value)} />
          </div>
          {forecastError ? <div className="mt-3 text-sm text-danger">{forecastError}</div> : null}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {forecast.map((entry) => (
              <div key={entry.slot} className={['rounded-2xl border p-3', entry.severe ? 'border-danger/30 bg-danger/10' : 'border-white/10 bg-white/5'].join(' ')}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold capitalize">{entry.slot} <span className="text-xs font-normal normal-case text-muted">{formatSlotRange(slotHours, entry.slot)}</span></div>
                  {entry.severe ? <span className="text-[10px] font-bold uppercase tracking-widest text-danger">Advisory</span> : null}
                </div>
                <div className="mt-2 text-xs text-muted">{entry.summary}</div>
                {entry.available ? (
                  <div className="mt-2 text-xs text-muted">Wind up to {entry.windKph} km/h</div>
                ) : null}
                {entry.reasons.length ? <div className="mt-2 text-xs text-danger">{entry.reasons.join('; ')}</div> : null}
                {canSend && entry.available ? (
                  <button type="button" onClick={() => fillFromForecast(entry)} className="mt-2 text-[11px] font-semibold text-accent hover:underline">
                    Write advisory from this
                  </button>
                ) : null}
              </div>
            ))}
            {configured && !forecastError && forecast.length === 0 ? <div className="text-sm text-muted">Loading…</div> : null}
          </div>
          <p className="mt-3 text-[11px] text-muted">Forecasts cover the next 5 days. Slot hours are set on the Reservations page.</p>
        </Card>

        {canSend ? (
          <Card className="p-4">
            <div className="mb-3 text-xs uppercase tracking-widest text-muted">Send an advisory</div>
            <form className="space-y-3" onSubmit={send}>
              <div className="text-xs text-muted">
                To everyone booked at {LOCATIONS.find((l) => l.id === location)?.name} on {date}.
              </div>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} className={selectClass}>
                <option value="">All time slots</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={1000}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40"
                placeholder="e.g. Heavy rain is expected tomorrow morning. Games will go ahead; bring a change of clothes."
              />
              <Button type="submit" className="w-full" disabled={sending || message.trim().length < 10}>
                {sending ? 'Sending…' : 'Send email and in-app notice'}
              </Button>
            </form>
          </Card>
        ) : null}
      </div>

      <Card className="p-4">
        <div className="mb-3 text-xs uppercase tracking-widest text-muted">Sent advisories</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="py-2 pr-4">Sent</th>
                <th className="py-2 pr-4">Game</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Message</th>
                <th className="py-2 text-right">Players</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {advisories.length === 0 ? (
                <tr><td colSpan={5} className="py-3 text-muted">No advisories sent yet.</td></tr>
              ) : advisories.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-xs text-muted">{new Date(a.createdAtISO).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-xs">{a.date} · {a.slot || 'all slots'} · {LOCATIONS.find((l) => l.id === a.locationId)?.name || a.locationId}</td>
                  <td className="py-2 pr-4 text-xs">{a.source === 'auto' ? 'Automatic' : a.createdBy?.actorEmail || 'Staff'}</td>
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
