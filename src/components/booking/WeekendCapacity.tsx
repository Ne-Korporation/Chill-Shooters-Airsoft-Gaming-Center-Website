import React, { useEffect, useState } from 'react'
import { FiMapPin, FiUsers } from 'react-icons/fi'
import { getApiBase } from '../../utils/apiClient'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type SlotCapacity = { slot: string; capacity: number; booked: number; remaining: number }
type LocationCapacity = { id: string; name: string; capacity: number; booked: number; slots: SlotCapacity[] }
type WeekendDay = { dateISO: string; past: boolean; capacity: number; booked: number; locations: LocationCapacity[] }

const SLOT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }

// How full this week's weekend (public) games are, from GET /api/public/weekend-capacity.
// Readable without signing in, so the landing page can show it too.
function useWeekendCapacity() {
  const [state, setState] = useState<{ loading: boolean; days: WeekendDay[]; failed: boolean }>({ loading: true, days: [], failed: false })
  useEffect(() => {
    let alive = true
    const load = () => fetch(`${getApiBase()}/api/public/weekend-capacity`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => { if (alive) setState({ loading: false, days: Array.isArray(body?.data) ? body.data : [], failed: false }) })
      .catch(() => { if (alive) setState((current) => ({ ...current, loading: false, failed: current.days.length === 0 })) })
    void load()
    // Bookings come in all week; refresh while the page is open.
    const timer = window.setInterval(load, 120_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return state
}

function fillTone(booked: number, capacity: number) {
  const ratio = capacity > 0 ? booked / capacity : 0
  if (ratio >= 1) return { bar: 'bg-danger', text: 'text-danger', label: 'Full' }
  if (ratio >= 0.85) return { bar: 'bg-danger', text: 'text-danger', label: 'Almost full' }
  if (ratio >= 0.6) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Filling up' }
  return { bar: 'bg-success', text: 'text-success', label: 'Open' }
}

function Bar({ booked, capacity, className = 'h-1.5' }: { booked: number; capacity: number; className?: string }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0
  return (
    <div className={`${className} overflow-hidden rounded-full bg-[rgba(var(--text),0.08)]`} role="presentation">
      <div className={`h-full rounded-full transition-all ${fillTone(booked, capacity).bar}`} style={{ width: `${Math.max(pct, booked > 0 ? 2 : 0)}%` }} />
    </div>
  )
}

function formatDay(dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00`)
  return {
    weekday: date.toLocaleDateString('en-PH', { weekday: 'long' }),
    date: date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
  }
}

export function WeekendCapacity({
  title = "This weekend's public games",
  subtitle = 'Weekends are open games anyone can join. See how many players have booked so far.',
  compact = false,
  action,
}: {
  title?: string
  subtitle?: string
  // Tighter layout for the dashboard.
  compact?: boolean
  action?: React.ReactNode
}) {
  const { loading, days, failed } = useWeekendCapacity()
  const slotHours = useSlotHours()

  if (failed) return null

  return (
    <div className={compact ? '' : 'surface rounded-2xl p-5 md:p-6'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className={`${compact ? 'text-sm' : 'text-lg'} flex items-center gap-2 font-bold`}>
            <FiUsers className="text-accent" /> {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted md:text-sm">{subtitle}</p>
        </div>
        {action}
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[0, 1].map((key) => <div key={key} className="h-40 animate-pulse rounded-xl bg-[rgba(var(--text),0.05)]" />)}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {days.map((day) => {
            const label = formatDay(day.dateISO)
            const tone = fillTone(day.booked, day.capacity)
            return (
              <div key={day.dateISO} className={`rounded-xl border border-[rgba(var(--text),0.1)] p-4 ${day.past ? 'opacity-60' : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-bold">{label.weekday}</span>
                    <span className="ml-2 text-xs text-muted">{label.date}</span>
                  </div>
                  <span className={`text-xs font-semibold ${day.past ? 'text-muted' : tone.text}`}>{day.past ? 'Done' : tone.label}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  <span className="font-semibold text-text">{day.booked.toLocaleString()}</span> of {day.capacity.toLocaleString()} spots booked
                </div>
                <Bar booked={day.booked} capacity={day.capacity} className="mt-2 h-2" />

                <ul className="mt-3 space-y-3">
                  {day.locations.map((location) => (
                    <li key={location.id}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                          <FiMapPin className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <span className="truncate">{location.name}</span>
                        </span>
                        <span className="shrink-0 text-muted">{location.booked}/{location.capacity}</span>
                      </div>
                      {!compact ? <Bar booked={location.booked} capacity={location.capacity} className="mt-1.5 h-1.5" /> : null}
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {location.slots.map((slot) => {
                          const slotTone = fillTone(slot.booked, slot.capacity)
                          return (
                            <div
                              key={slot.slot}
                              className="rounded-lg bg-[rgba(var(--text),0.04)] px-2 py-1.5"
                              title={`${SLOT_LABELS[slot.slot] || slot.slot} ${formatSlotRange(slotHours, slot.slot)}: ${slot.booked} of ${slot.capacity} booked, ${slot.remaining} left`}
                            >
                              <div className="text-[10px] uppercase tracking-wider text-muted">{SLOT_LABELS[slot.slot] || slot.slot}</div>
                              <div className={`text-xs font-semibold ${slot.remaining === 0 ? 'text-danger' : ''}`}>
                                {slot.remaining === 0 ? 'Full' : `${slot.remaining} left`}
                              </div>
                              <Bar booked={slot.booked} capacity={slot.capacity} className="mt-1 h-1" />
                              <span className="sr-only">{slotTone.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
