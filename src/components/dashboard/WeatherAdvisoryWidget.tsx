import React, { useCallback, useEffect, useState } from 'react'
import { FiChevronRight, FiCloud, FiCloudRain, FiSun } from 'react-icons/fi'
import { Modal } from '../ui/Modal'
import { apiGet } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { WeatherPanel } from '../../pages/admin/AdminWeatherPage'

type CurrentAdvisory = {
  id: string
  source: 'auto' | 'manual' | 'forecast'
  locationId: string
  locationName: string
  date: string
  slot: string | null
  title: string
  message: string
  createdAtISO: string
  mine: boolean
}

type SlotForecast = {
  slot: string
  hours: { start: string; end: string } | null
  severe: boolean
  rainy: boolean
  summary: string
  rainChancePercent: number
  rainMm: number
  windKph: number
  tempC: number
}

type DayForecast = {
  locationId: string
  locationName: string
  date: string
  slots: SlotForecast[]
  updatedAtISO: string
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

const DAYS_SHOWN = 7

// YYYY-MM-DD in Manila time, `offset` days from today.
function manilaISO(offset: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + offset * 86_400_000))
}
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Dashboard widget on every account: weather advisories for today and the coming days. The
// server checks the forecast for booked slots automatically the day before each game; staff can
// also send one from here.
export function WeatherAdvisoryWidget() {
  const { user } = useAuth()
  const isStaff = user?.role === 'admin' || user?.role === 'registrar' || user?.role === 'marshal'
  const [advisories, setAdvisories] = useState<CurrentAdvisory[]>([])
  const [forecast, setForecast] = useState<DayForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: CurrentAdvisory[]; forecast?: DayForecast[] }>('/api/weather-advisories/current')
      setAdvisories(Array.isArray(res?.data) ? res.data : [])
      setForecast(Array.isArray(res?.forecast) ? res.forecast : [])
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
  const hasAdvisory = sorted.length > 0
  const hasMine = sorted.some((a) => a.mine)
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })

  // Today plus the next six days, each with its forecast and the advisories posted for it.
  const allDays = Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const iso = manilaISO(i)
    const dayForecast = forecast.filter((f) => f.date === iso && f.slots.length > 0)
    const temps = dayForecast.flatMap((f) => f.slots.map((s) => s.tempC))
    return {
      iso,
      advisories: sorted.filter((a) => a.date === iso),
      forecast: dayForecast,
      wet: dayForecast.some((f) => f.slots.some((s) => s.rainy || s.severe)),
      maxTemp: temps.length ? Math.max(...temps) : null,
    }
  })
  // Only days with a forecast or an advisory (the free forecast covers about 5 days, and
  // today drops out once its slots are over). Before anything has loaded, today stays.
  const covered = allDays.filter((d) => d.forecast.length > 0 || d.advisories.length > 0)
  const days = covered.length ? covered : allDays.slice(0, 1)
  const [selectedDay, setSelectedDay] = useState<string>(days[0].iso)
  const selected = days.find((d) => d.iso === selectedDay) || days[0]

  const openDetails = () => {
    // Open on the first day that has an advisory, or today.
    setSelectedDay((days.find((d) => d.advisories.length > 0) || days.find((d) => d.forecast.length > 0) || days[0]).iso)
    setDetailsOpen(true)
  }

  return (
    <>
      {/* Compact bar: a weather icon and today's date. The week's advisories open in a pop-up. */}
      <button
        type="button"
        onClick={openDetails}
        title={loading ? 'Checking weather advisories…' : hasAdvisory ? `${sorted.length} weather advisor${sorted.length === 1 ? 'y' : 'ies'}` : 'No weather advisories'}
        aria-label="Weather advisories"
        className={[
          'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:bg-white/10',
          hasMine ? 'border-warning/40 bg-warning/10 text-warning' : 'border-white/10 bg-white/5 text-text',
        ].join(' ')}
      >
        {hasAdvisory ? <FiCloudRain className="shrink-0 text-xl text-gold" /> : <FiSun className="shrink-0 text-xl text-gold" />}
        <span className="flex-1 text-left">{todayLabel}</span>
        <FiChevronRight className="shrink-0 text-muted" />
      </button>

      {detailsOpen ? (
        <Modal eyebrow="Weather" title="Weather advisories" onClose={() => setDetailsOpen(false)}>
          {isStaff ? (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setDetailsOpen(false)
                  setManageOpen(true)
                }}
                className="text-[11px] font-semibold text-accent hover:underline"
              >
                Forecast &amp; send
              </button>
            </div>
          ) : null}

          <div className="flex gap-1.5 sm:gap-2">
            {days.map((d) => {
              const active = d.iso === selected.iso
              const mine = d.advisories.some((a) => a.mine)
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setSelectedDay(d.iso)}
                  aria-pressed={active}
                  className={[
                    'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold transition sm:px-2',
                    active ? 'border-accent/60 bg-accent/15 text-text' : mine ? 'border-warning/40 bg-warning/10 text-warning' : 'border-white/10 bg-white/5 text-muted hover:bg-white/10',
                  ].join(' ')}
                >
                  <span>{shortDay(d.iso)}</span>
                  {d.advisories.length > 0 || d.wet ? <FiCloudRain className="text-lg text-gold" /> : d.forecast.length ? <FiSun className="text-lg text-gold" /> : <FiCloud className="text-lg text-muted" />}
                  <span>{shortDate(d.iso)}</span>
                  {d.maxTemp !== null ? <span className="text-[10px] font-normal text-muted">{d.maxTemp}°C</span> : null}
                </button>
              )
            })}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(selected.iso)}</div>
            {loading ? (
              <div className="text-xs text-muted">Checking the forecast…</div>
            ) : (
              <div className="space-y-3">
                {selected.forecast.length > 0 ? (
                  <DayForecastList items={selected.forecast} />
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted">
                    <FiCloud className="mt-0.5 shrink-0" />
                    <span>No forecast available right now. Try again in a few minutes.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="mt-4 border-t border-white/10 pt-3 text-[11px] text-muted">
            We play rain or shine unless the marshals stop play for safety. If weather stops you from coming, contact us and staff can move your booking and payment to another date. Payments are not refundable.
          </p>
        </Modal>
      ) : null}

      {manageOpen ? (
        <Modal
          eyebrow="Weather"
          title="Weather advisories"
          onClose={() => {
            setManageOpen(false)
            void load()
          }}
          size="xl"
          // A workspace whose actions save as they go, so there's nothing unsaved to lose.
          confirmDiscard={false}
        >
          <WeatherPanel />
        </Modal>
      ) : null}
    </>
  )
}

// 24-hour "HH:MM" as "1 PM" / "1:30 PM".
function to12h(value: string) {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h)) return value
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`
}

// One word for a slot's weather.
function conditionOf(s: SlotForecast) {
  const text = s.summary.toLowerCase()
  if (text.includes('thunder')) return 'Storm'
  if (s.rainy || s.severe) return s.windKph >= 61 && !s.rainy ? 'Windy' : 'Rain'
  if (/overcast|broken clouds/.test(text)) return 'Cloudy'
  if (/clouds/.test(text)) return 'Fair'
  return 'Sunny'
}

function SlotIcon({ s }: { s: SlotForecast }) {
  const c = conditionOf(s)
  if (c === 'Rain' || c === 'Storm') return <FiCloudRain className="text-base text-gold" />
  if (c === 'Cloudy' || c === 'Fair') return <FiCloud className="text-base text-muted" />
  return <FiSun className="text-base text-gold" />
}

// Compact forecast: one row per field, one cell per slot (icon, temperature, rain chance).
// Hovering a cell shows the full reading.
function DayForecastList({ items }: { items: DayForecast[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.75rem)] items-center gap-x-2 gap-y-2 text-xs">
        <span />
        {SLOT_LABELS.map((label) => (
          <span key={label} className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        ))}
        {items.map((f) => (
          <React.Fragment key={f.locationId}>
            <span className="truncate font-semibold text-text" title={f.locationName}>{shortLocation(f.locationName)}</span>
            {SLOT_KEYS.map((slot) => {
              const s = f.slots.find((x) => x.slot === slot)
              if (!s) return <span key={slot} className="text-center text-muted">–</span>
              return (
                <span
                  key={slot}
                  title={`${capitalize(s.summary)}${s.hours ? ` (${to12h(s.hours.start)}–${to12h(s.hours.end)})` : ''}, wind ${s.windKph} km/h`}
                  className={['flex flex-col items-center leading-tight', s.severe ? 'text-warning' : 'text-text'].join(' ')}
                >
                  <SlotIcon s={s} />
                  <span className="font-semibold">{s.tempC}°</span>
                  <span className="text-[10px] text-muted">{s.rainChancePercent}%</span>
                </span>
              )
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">Temperature and chance of rain per slot.</p>
    </div>
  )
}

const SLOT_KEYS = ['morning', 'afternoon', 'evening']
const SLOT_LABELS = ['AM', 'PM', 'Eve']
// "Chill Shooters (Salawag)" → "Salawag", "BBC Airsoft Binan Laguna" → "Biñan".
function shortLocation(name: string) {
  const inParens = name.match(/\(([^)]+)\)/)
  if (inParens) return inParens[1]
  if (/binan/i.test(name)) return 'Biñan'
  return name
}
