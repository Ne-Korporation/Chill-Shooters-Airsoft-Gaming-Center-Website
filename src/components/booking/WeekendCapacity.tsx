import React, { useEffect, useState } from 'react'
import { FiHeart, FiUsers } from 'react-icons/fi'
import { getApiBase } from '../../utils/apiClient'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'
import { causeDayMessage, type CauseDay } from '../../utils/causeDays'

export type SlotCapacity = { slot: string; capacity: number; booked: number; remaining: number; groups?: number }
export type LocationCapacity = { id: string; name: string; capacity: number; booked: number; groups?: number; slots: SlotCapacity[] }
export type WeekendDay = { dateISO: string; past: boolean; capacity: number; booked: number; groups?: number; kind?: 'public' | 'private'; locations: LocationCapacity[] }


// How full this week's weekend (public) games are, from GET /api/public/weekend-capacity.
// Readable without signing in, so the landing page can show it too.
function useWeekendCapacity() {
  const [state, setState] = useState<{ loading: boolean; days: WeekendDay[]; causeDays: CauseDay[]; failed: boolean }>({ loading: true, days: [], causeDays: [], failed: false })
  useEffect(() => {
    let alive = true
    const load = () => fetch(`${getApiBase()}/api/public/weekend-capacity`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => { if (alive) setState({ loading: false, days: Array.isArray(body?.data) ? body.data : [], causeDays: Array.isArray(body?.causeDays) ? body.causeDays : [], failed: false }) })
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

export function fillTone(booked: number, capacity: number) {
  const ratio = capacity > 0 ? booked / capacity : 0
  if (ratio >= 1) return { bar: 'bg-danger', text: 'text-danger', label: 'Full' }
  if (ratio >= 0.85) return { bar: 'bg-danger', text: 'text-danger', label: 'Almost full' }
  if (ratio >= 0.6) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Filling up' }
  return { bar: 'bg-success', text: 'text-success', label: 'Open' }
}

export function Bar({ booked, capacity, className = 'h-1.5' }: { booked: number; capacity: number; className?: string }) {
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
  title = 'This weekend',
  subtitle = 'Spots left in the public games. Anyone can join.',
  compact = false,
  action,
}: {
  title?: string
  subtitle?: string
  // Tighter layout for the dashboard.
  compact?: boolean
  action?: React.ReactNode
}) {
  const { loading, days, causeDays, failed } = useWeekendCapacity()
  const causeByDate = Object.fromEntries(causeDays.map((cause) => [cause.dateISO, cause]))

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
              <div key={day.dateISO} className={`flex h-full flex-col rounded-xl border border-[rgba(var(--text),0.1)] p-4 ${day.past ? 'opacity-60' : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-bold">{label.weekday}</span>
                    <span className="ml-2 text-xs text-muted">{label.date}</span>
                  </div>
                  <span className={`text-xs font-semibold ${day.past ? 'text-muted' : tone.text}`}>{day.past ? 'Done' : tone.label}</span>
                </div>
                {causeByDate[day.dateISO] ? (
                  <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400" title={causeDayMessage(causeByDate[day.dateISO])}>
                    <FiHeart className="mt-0.5 shrink-0" /> Game for a cause: {causeByDate[day.dateISO].title}
                  </div>
                ) : null}
                {/* mt-auto keeps the tables of side-by-side days level even when only one has a cause banner. */}
                <div className="mt-auto pt-2">
                  <DaySlotsTable day={day} past={day.past} note={false} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!loading ? <div className="mt-2 text-[11px] text-muted">Numbers are spots left. Anyone can join a public game.</div> : null}
    </div>
  )
}

// Weekends are public games. Older servers only sent weekends and no `kind`.
export function isPublicDay(day: WeekendDay) {
  return (day.kind ?? 'public') === 'public'
}

const SLOT_NAMES: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
export const SHORT_LOCATION: Record<string, string> ={ salawag: 'Salawag', langkaan: 'Langkaan', binan: 'Biñan' }

// One day at a glance: a row per location, a column per time slot. Public days show spots left;
// private days show how many groups have booked each slot.
export function DaySlotsTable({ day, past, note = true }: { day: WeekendDay; past: boolean; note?: boolean }) {
  const slotHours = useSlotHours()
  const isPublic = isPublicDay(day)
  const slots = day.locations[0]?.slots.map((slot) => slot.slot) || []
  const groups = day.groups || 0
  const left = Math.max(0, day.capacity - day.booked)

  return (
    <div>
      <div className="text-sm">
        {isPublic ? (
          past ? <><span className="font-semibold">{day.booked.toLocaleString()}</span> players played</>
            : <><span className="font-semibold">{left.toLocaleString()}</span> spots left · {day.booked.toLocaleString()} booked</>
        ) : groups ? (
          <><span className="font-semibold">{groups}</span> private game{groups === 1 ? '' : 's'} booked</>
        ) : 'No private games booked yet. Every slot is open.'}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-[rgba(var(--text),0.1)]">
        {/* Fixed layout: every slot column gets the same width, so tables line up with each other
            no matter how long each slot's hours are. */}
        <table className="w-full min-w-[20rem] table-fixed text-sm">
          <colgroup>
            <col className="w-[28%]" />
            {slots.map((slot) => <col key={slot} />)}
          </colgroup>
          <thead>
            <tr className="bg-[rgba(var(--text),0.04)] text-[11px] text-muted">
              <th className="px-3 py-2 text-left align-middle font-semibold">Location</th>
              {slots.map((slot) => (
                <th key={slot} className="px-1.5 py-2 text-center align-middle font-semibold">
                  <div className="truncate">{SLOT_NAMES[slot] || slot}</div>
                  <div className="text-[10px] font-normal leading-tight">{formatSlotRange(slotHours, slot)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {day.locations.map((location) => (
              <tr key={location.id} className="border-t border-[rgba(var(--text),0.08)]">
                <td className="truncate px-3 py-2 text-left align-middle font-semibold" title={location.name}>{SHORT_LOCATION[location.id] || location.name}</td>
                {location.slots.map((slot) => {
                  if (!isPublic) {
                    const booked = slot.groups || 0
                    const full = slot.remaining === 0
                    return (
                      <td key={slot.slot} className={`whitespace-nowrap px-1.5 py-2 text-center align-middle tabular-nums ${full ? 'font-semibold text-danger' : booked ? 'font-semibold text-accent' : 'text-muted'}`}>
                        {full ? 'Full' : booked ? `${booked} booked` : 'Free'}
                      </td>
                    )
                  }
                  const tone = fillTone(slot.booked, slot.capacity)
                  return (
                    <td key={slot.slot} className={`whitespace-nowrap px-1.5 py-2 text-center align-middle font-semibold tabular-nums ${past ? 'text-muted' : tone.text}`} title={`${slot.booked} of ${slot.capacity} booked`}>
                      {past ? `${slot.booked} played` : slot.remaining === 0 ? 'Full' : `${slot.remaining.toLocaleString()} left`}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {note ? <div className="mt-2 text-[11px] text-muted">
        {isPublic
          ? past ? 'Numbers are players who booked.' : 'Numbers are spots left. Anyone can join a public game.'
          : 'Private games are for your own group of 10 or more.'}
      </div> : null}
    </div>
  )
}
