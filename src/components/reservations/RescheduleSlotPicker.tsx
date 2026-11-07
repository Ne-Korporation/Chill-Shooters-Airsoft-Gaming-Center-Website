import React, { useEffect, useMemo, useState } from 'react'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'
import { formatSlotRange, type SlotHours } from '../../utils/slotHours'
import { closedDayMessage, useClosedDays } from '../../utils/closedDays'

const SLOTS = ['morning', 'afternoon', 'evening'] as const
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Booking = {
  dateISO: string
  slot: string
  sessionType?: string
  players: number
  fieldIds?: string[]
  locationId?: string
}
type Capacities = Record<string, Record<string, number>>

export type RescheduleTarget = {
  locationId: string
  sessionType: string
  players: number
  fieldIds: string[]
  originalDate: string
  originalSlot: string
}

export function isWeekdayISO(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function addDaysISO(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeLocation(value: string) {
  const lower = String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (lower.includes('salawag')) return 'salawag'
  if (lower.includes('langkaan')) return 'langkaan'
  if (lower.includes('binan')) return 'binan'
  return lower
}

type SlotState = { available: boolean; remaining: number; reason: string }

// A month calendar that only offers dates of the same kind as the original booking (weekday or
// weekend), and for the picked date shows each time slot with the places still free, so the player
// sees what is open before submitting. The server re-checks everything when the move is saved.
export function RescheduleSlotPicker({
  target,
  todayISO,
  slotHours,
  date,
  slot,
  onChange,
}: {
  target: RescheduleTarget
  todayISO: string
  slotHours: SlotHours
  date: string
  slot: string
  onChange: (next: { date: string; slot: string }) => void
}) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [capacities, setCapacities] = useState<Capacities>({})
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(() => (date || addDaysISO(todayISO, 1)).slice(0, 7))
  const closedDays = useClosedDays(`${month}-01`, `${month}-31`)
  const locationId = normalizeLocation(target.locationId)
  const weekdayBooking = target.originalDate ? isWeekdayISO(target.originalDate) : false

  useEffect(() => {
    let alive = true
    setLoading(true)
    apiGet<{ ok: boolean; data: Booking[]; capacities?: Capacities }>('/api/reservation-availability')
      .then((res) => {
        if (!alive) return
        setBookings(Array.isArray(res?.data) ? res.data : [])
        setCapacities(res?.capacities || {})
      })
      .catch(() => {
        if (alive) setBookings([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const slotState = (dateISO: string, slotName: string): SlotState => {
    const isOriginal = dateISO === target.originalDate && slotName === target.originalSlot
    const same = bookings.filter((booking) =>
      booking.dateISO === dateISO && String(booking.slot).toLowerCase() === slotName && normalizeLocation(booking.locationId || '') === locationId)
    // The player's own booking is still counted in its current slot; leave it out of that one.
    const used = same.reduce((sum, booking) => sum + Number(booking.players || 0), 0) - (isOriginal ? target.players : 0)
    const capacity = Number(capacities[locationId]?.[slotName] ?? 0)
    const remaining = capacity ? Math.max(0, capacity - used) : Number.POSITIVE_INFINITY
    if (isOriginal) return { available: false, remaining, reason: 'Current slot' }
    if (remaining < target.players) return { available: false, remaining, reason: remaining === 0 ? 'Full' : `Only ${remaining} places left` }
    if (target.sessionType === 'private') {
      const taken = new Set(same.filter((booking) => booking.sessionType === 'private').flatMap((booking) => booking.fieldIds || []))
      if (target.fieldIds.some((fieldId) => taken.has(fieldId))) return { available: false, remaining, reason: 'Your field is booked' }
    }
    return { available: true, remaining, reason: '' }
  }

  const dateAllowed = (dateISO: string) => dateISO > todayISO && isWeekdayISO(dateISO) === weekdayBooking && !closedDays[dateISO]
  const dateHasOpenSlot = (dateISO: string) => SLOTS.some((name) => slotState(dateISO, name).available)

  const days = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00Z`)
    const lead = first.getUTCDay()
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
    ]
  }, [month])

  const shiftMonth = (delta: number) => {
    const [year, monthIndex] = month.split('-').map(Number)
    const next = new Date(Date.UTC(year, monthIndex - 1 + delta, 1))
    setMonth(next.toISOString().slice(0, 7))
  }
  const canGoBack = month > todayISO.slice(0, 7)
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shiftMonth(-1)} disabled={!canGoBack} className="surface hover-row rounded-lg p-1.5 disabled:opacity-30" aria-label="Previous month">
            <FiChevronLeft />
          </button>
          <div className="text-sm font-semibold">{monthLabel}</div>
          <button type="button" onClick={() => shiftMonth(1)} className="surface hover-row rounded-lg p-1.5" aria-label="Next month">
            <FiChevronRight />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-muted">
          {WEEKDAY_LABELS.map((label) => <div key={label}>{label}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((dayISO, index) => {
            if (!dayISO) return <div key={`blank-${index}`} />
            const allowed = dateAllowed(dayISO)
            const open = allowed && !loading && dateHasOpenSlot(dayISO)
            const selected = dayISO === date
            return (
              <button
                key={dayISO}
                type="button"
                disabled={!allowed || (!loading && !open)}
                onClick={() => {
                  const firstOpen = SLOTS.find((name) => slotState(dayISO, name).available)
                  onChange({ date: dayISO, slot: slotState(dayISO, slot).available ? slot : firstOpen || slot })
                }}
                title={closedDays[dayISO] ? closedDayMessage(closedDays[dayISO]) : !allowed ? (weekdayBooking ? 'Weekday bookings move to weekdays only' : 'Weekend bookings move to weekends only') : open ? 'Has open slots' : 'No open slots'}
                className={[
                  'h-9 rounded-lg text-xs font-semibold transition',
                  selected
                    ? 'bg-accent text-background'
                    : open
                      ? 'border border-success/30 bg-success/10 text-text hover:bg-success/20'
                      : allowed && loading
                        ? 'border border-white/10 text-text'
                        : 'text-muted/40',
                  dayISO === target.originalDate && !selected ? 'ring-1 ring-accent/50' : '',
                ].join(' ')}
              >
                {Number(dayISO.slice(8))}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-success/40" /> Open</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded ring-1 ring-accent/60" /> Current date</span>
          <span>{weekdayBooking ? 'Weekdays only (booked on a weekday)' : 'Weekends only (booked on a weekend)'}</span>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted">
          {date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Pick a date'}
        </div>
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="Time slot">
          {SLOTS.map((name) => {
            const state = date ? slotState(date, name) : { available: false, remaining: 0, reason: 'Pick a date first' }
            const selected = slot === name && Boolean(date)
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!date || !state.available}
                onClick={() => onChange({ date, slot: name })}
                className={[
                  'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition',
                  selected ? 'border-accent/60 bg-accent/15' : state.available ? 'border-white/10 bg-white/5 hover:border-accent/30' : 'border-white/5 bg-black/10 opacity-60',
                ].join(' ')}
              >
                <span>
                  <span className="font-semibold capitalize">{name}</span>
                  <span className="ml-2 text-xs text-muted">{formatSlotRange(slotHours, name)}</span>
                </span>
                <span className={['text-xs font-semibold', state.available ? 'text-success' : 'text-muted'].join(' ')}>
                  {loading ? 'Checking…' : state.available ? (Number.isFinite(state.remaining) ? `${state.remaining} places left` : 'Open') : state.reason}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
