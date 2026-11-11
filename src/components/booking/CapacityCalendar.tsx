import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCalendar, FiChevronLeft, FiChevronRight, FiHeart, FiSlash, FiTrash2 } from 'react-icons/fi'
import { apiPost, apiPut, getApiBase } from '../../utils/apiClient'
import { causeDayMessage, type CauseDay } from '../../utils/causeDays'
import { closedDayMessage, type ClosedDay } from '../../utils/closedDays'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Bar, DaySlotsTable, fillTone, isPublicDay, SHORT_LOCATION, type LocationCapacity, type WeekendDay } from './WeekendCapacity'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The location picked in the calendar, remembered per browser. 'all' shows every location.
const LOCATION_KEY = 'capacityCalendar.location'
const ALL = 'all'

function readSavedLocation() {
  try { return window.localStorage.getItem(LOCATION_KEY) || ALL } catch { return ALL }
}

function hasSavedLocation() {
  try { return window.localStorage.getItem(LOCATION_KEY) !== null } catch { return false }
}

function saveLocation(locationId: string) {
  try { window.localStorage.setItem(LOCATION_KEY, locationId) } catch { /* storage blocked: just don't remember */ }
}

function locationLabel(location: { id: string; name: string }) {
  return SHORT_LOCATION[location.id] || location.name
}

// One location's share of a day, in the same shape as a whole day, so the cells and the day
// table show only that location. 'all' keeps the whole day.
function dayAtLocation(day: WeekendDay | undefined, locationId: string): WeekendDay | undefined {
  if (!day || locationId === ALL) return day
  const location = day.locations.find((entry) => entry.id === locationId)
  if (!location) return undefined
  return { ...day, capacity: location.capacity, booked: location.booked, groups: location.groups || 0, locations: [location] }
}

// For "All locations": the least-full location, so a day reads as open while any location has room.
function leastFull(day: WeekendDay): LocationCapacity | undefined {
  const ratio = (location: LocationCapacity) => (location.capacity > 0 ? location.booked / location.capacity : 1)
  return day.locations.reduce<LocationCapacity | undefined>((best, location) => (!best || ratio(location) < ratio(best) ? location : best), undefined)
}

function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function shiftMonth(month: string, by: number) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + by, 1))
  return date.toISOString().slice(0, 7)
}

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

function longDate(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// Weeks of a month as rows of 7 (Sunday first); blanks pad the first and last week.
function monthGrid(month: string) {
  const [year, mon] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: first }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(`${month}-${String(day).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

function useCapacityMonth(month: string) {
  const [state, setState] = useState<{ loading: boolean; days: WeekendDay[]; causeDays: CauseDay[]; closedDays: ClosedDay[]; todayISO: string }>({ loading: true, days: [], causeDays: [], closedDays: [], todayISO: manilaToday() })
  const load = useCallback(() => {
    return fetch(`${getApiBase()}/api/public/capacity-calendar?month=${encodeURIComponent(month)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => setState({
        loading: false,
        days: Array.isArray(body?.data) ? body.data : [],
        causeDays: Array.isArray(body?.causeDays) ? body.causeDays : [],
        closedDays: Array.isArray(body?.closedDays) ? body.closedDays : [],
        todayISO: body?.todayISO || manilaToday(),
      }))
      .catch(() => setState((current) => ({ ...current, loading: false })))
  }, [month])
  useEffect(() => {
    setState((current) => ({ ...current, loading: true }))
    void load()
    const timer = window.setInterval(() => { void load() }, 120_000)
    return () => window.clearInterval(timer)
  }, [load])
  return { ...state, reload: load }
}

// Month calendar of public-game capacity (weekends) and games for a cause. Admins (`editable`)
// click any upcoming day to make it a game for a cause, edit it, or turn it back into a regular day.
export function CapacityCalendar({
  title = 'Games calendar',
  subtitle = 'Weekends are public games anyone can join. Weekdays are private games for your group.',
  editable = false,
  compact = false,
  mini = false,
  action,
  defaultLocation,
}: {
  title?: string
  subtitle?: string
  editable?: boolean
  compact?: boolean
  // Small version for the sidebar: dates with a status dot; tap a day for details.
  mini?: boolean
  action?: React.ReactNode
  // Location to start on when the viewer hasn't picked one yet (e.g. a player's last booking).
  defaultLocation?: string
}) {
  const [month, setMonth] = useState(() => manilaToday().slice(0, 7))
  const { loading, days, causeDays, closedDays, todayISO, reload } = useCapacityMonth(month)
  const [openDate, setOpenDate] = useState<string | null>(null)
  // A pick the viewer made wins; otherwise the default (which may arrive after a fetch), else all.
  const [pickedLocation, setPickedLocation] = useState<string | null>(() => (hasSavedLocation() ? readSavedLocation() : null))
  const locations = useMemo(() => days.find((day) => day.locations.length)?.locations || [], [days])
  const wanted = pickedLocation ?? defaultLocation ?? ALL
  // Fall back to all locations if the saved one no longer exists (only once the data is in).
  const location = wanted === ALL || !locations.length || locations.some((entry) => entry.id === wanted) ? wanted : ALL
  const pickLocation = (locationId: string) => {
    setPickedLocation(locationId)
    saveLocation(locationId)
  }
  const capacityByDate = useMemo(
    () => Object.fromEntries(days.map((day) => [day.dateISO, dayAtLocation(day, location)])) as Record<string, WeekendDay | undefined>,
    [days, location],
  )
  const causeByDate = useMemo(() => Object.fromEntries(causeDays.map((cause) => [cause.dateISO, cause])), [causeDays])
  const closedByDate = useMemo(() => Object.fromEntries(closedDays.map((day) => [day.dateISO, day])), [closedDays])
  const weeks = useMemo(() => monthGrid(month), [month])
  const currentMonth = todayISO.slice(0, 7)

  return (
    <div className={compact || mini ? '' : 'surface rounded-2xl p-5 md:p-6'}>
      {mini ? (
        <h3 className="flex items-center gap-2 px-1 text-sm font-bold"><FiCalendar className="text-accent" /> {title}</h3>
      ) : (
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className={`${compact ? 'text-sm' : 'text-lg'} flex items-center gap-2 font-bold`}>
            <FiCalendar className="text-accent" /> {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted md:text-sm">{subtitle}</p>
        </div>
        {action}
      </div>
      )}

      {locations.length > 1 ? (
        mini ? (
          <select
            aria-label="Location"
            value={location}
            onChange={(e) => pickLocation(e.target.value)}
            className="mt-2 w-full rounded-lg border border-[rgba(var(--text),0.12)] bg-background px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            <option value={ALL}>All locations</option>
            {locations.map((entry) => <option key={entry.id} value={entry.id}>{locationLabel(entry)}</option>)}
          </select>
        ) : (
          <div role="tablist" aria-label="Location" className={`${compact ? 'mt-3' : 'mt-4'} flex flex-wrap gap-1.5`}>
            {[{ id: ALL, label: 'All locations', title: 'All locations' }, ...locations.map((entry) => ({ id: entry.id, label: locationLabel(entry), title: entry.name }))].map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={location === entry.id}
                title={entry.title}
                onClick={() => pickLocation(entry.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  location === entry.id
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-[rgba(var(--text),0.12)] text-muted hover:border-accent/50 hover:text-text'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )
      ) : null}

      <div className={`${mini ? 'mt-2' : 'mt-4'} flex items-center justify-between gap-2 rounded-xl bg-[rgba(var(--text),0.04)] p-1`}>
        <Button size="sm" variant="ghost" aria-label="Previous month" disabled={month <= currentMonth} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          <FiChevronLeft /> <span className={mini ? 'hidden' : 'hidden sm:inline'}>{monthLabel(shiftMonth(month, -1)).split(' ')[0]}</span>
        </Button>
        <div className="flex flex-col items-center">
          <div className={`${mini ? 'text-sm' : 'text-base'} font-bold`}>{monthLabel(month)}</div>
          {month !== currentMonth ? (
            <button type="button" className="text-[11px] font-semibold text-accent hover:underline" onClick={() => setMonth(currentMonth)}>
              Back to this month
            </button>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          <span className={mini ? 'hidden' : 'hidden sm:inline'}>{monthLabel(shiftMonth(month, 1)).split(' ')[0]}</span> <FiChevronRight />
        </Button>
      </div>

      <div className={`${mini ? 'mt-1' : 'mt-2'} grid grid-cols-7 ${mini ? 'gap-0.5' : 'gap-1'} text-center text-[10px] uppercase tracking-wider text-muted`}>
        {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1">{mini ? weekday[0] : weekday}</div>)}
      </div>
      <div className={`${mini ? 'space-y-0.5' : 'space-y-1'} ${loading ? 'animate-pulse' : ''}`}>
        {weeks.map((week, index) => (
          <div key={index} className={`grid grid-cols-7 ${mini ? 'gap-0.5' : 'gap-1'}`}>
            {week.map((dateISO, dayIndex) => {
              const cellHeight = mini ? 'h-7' : compact ? 'h-14' : 'h-16'
              if (!dateISO) return <div key={`blank-${dayIndex}`} className={cellHeight} />
              const day = capacityByDate[dateISO]
              const capacity = day && isPublicDay(day) ? day : undefined
              // Weekdays are private days, even when the server sent no data for them.
              const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay() % 6 !== 0
              const privateDay = weekday && !capacity
              const privateGroups = privateDay ? day?.groups || 0 : 0
              const privateFull = Boolean(privateDay && day && day.capacity > 0 && day.booked >= day.capacity)
              const cause = causeByDate[dateISO]
              const closed = closedByDate[dateISO]
              const past = dateISO < todayISO
              // "All locations" colours a public day by its least-full location: open while any has room.
              const best = capacity && location === ALL ? leastFull(capacity) : undefined
              const shown = best || capacity
              const tone = shown && !closed ? fillTone(shown.booked, shown.capacity) : null
              // Past days never open. Private days open for info unless fully booked.
              const clickable = !past && Boolean(
                capacity || cause || closed || editable
                || (privateDay && !privateFull),
              )
              const hint = closed ? closedDayMessage(closed) : [
                cause ? causeDayMessage(cause) : '',
                capacity
                  ? location === ALL
                    ? `Public game · ${capacity.locations.map((entry) => `${locationLabel(entry)} ${Math.max(0, entry.capacity - entry.booked)} left`).join(', ')}`
                    : `Public game · ${capacity.booked} of ${capacity.capacity} spots booked`
                  : privateFull ? 'Private games · fully booked'
                  : privateGroups ? `Private games · ${privateGroups} booked` : 'Private games · open to book',
              ].filter(Boolean).join(' · ')
              return (
                <button
                  key={dateISO}
                  type="button"
                  title={hint}
                  disabled={!clickable}
                  onClick={() => setOpenDate(dateISO)}
                  className={[
                    mini
                      ? `${cellHeight} relative flex flex-col items-center justify-center rounded-lg border text-[11px] transition`
                      : `${cellHeight} relative flex flex-col rounded-xl border px-1 py-1 text-left text-[11px] transition`,
                    closed ? 'border-dashed border-[rgba(var(--text),0.2)] bg-[rgba(var(--text),0.06)] text-muted'
                      : cause ? 'border-rose-500/40 bg-rose-500/10'
                      : capacity ? 'border-[rgba(var(--text),0.12)] bg-[rgba(var(--text),0.04)]'
                      : privateFull ? 'border-transparent bg-[rgba(var(--text),0.04)] text-muted'
                      : privateGroups ? 'border-accent/30 bg-accent/10'
                      : 'border-[rgba(var(--text),0.06)] text-muted',
                    dateISO === todayISO ? 'ring-2 ring-accent/60' : '',
                    past ? 'opacity-50' : '',
                    clickable ? 'cursor-pointer hover:border-accent/50' : 'cursor-default',
                  ].join(' ')}
                >
                  {mini ? (
                    <>
                      <span className="font-bold leading-none">{Number(dateISO.slice(8))}</span>
                      {(() => {
                        if (closed && !past) return <FiSlash className="mt-0.5 h-2.5 w-2.5 text-muted" aria-label="No games" />
                        const dot = past ? '' : cause ? 'bg-rose-500' : capacity ? tone?.bar : privateFull ? 'bg-danger' : privateGroups ? 'bg-accent' : ''
                        return dot ? <span className={`mt-1 h-1.5 w-1.5 rounded-full ${dot}`} /> : null
                      })()}
                    </>
                  ) : <>
                  <span className="flex items-center justify-between font-bold">
                    {Number(dateISO.slice(8))}
                    {closed ? <FiSlash className="h-3 w-3 text-muted" aria-label="No games" />
                      : cause ? <FiHeart className="h-3 w-3 text-rose-500" aria-label="Game for a cause" /> : null}
                  </span>
                  {closed ? (
                    <span className="mt-auto truncate text-[10px] font-semibold text-muted">No game</span>
                  ) : capacity ? (
                    <span className="mt-auto">
                      <span className={`block truncate text-[10px] font-semibold ${past ? 'text-muted' : tone?.text}`}>
                        {past ? 'Done' : best ? tone?.label : `${Math.max(0, capacity.capacity - capacity.booked)} left`}
                      </span>
                      {shown ? <Bar booked={shown.booked} capacity={shown.capacity} className="mt-0.5 h-1" /> : null}
                    </span>
                  ) : cause ? (
                    <span className="mt-auto truncate text-[10px] font-semibold text-rose-500">Cause</span>
                  ) : privateFull ? (
                    <span className="mt-auto truncate text-[10px] font-semibold text-danger">Full</span>
                  ) : privateGroups ? (
                    <span className="mt-auto truncate text-[10px] font-semibold text-accent">
                      {privateGroups} private
                    </span>
                  ) : null}
                  </>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {mini ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-muted">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" /> Open</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Filling</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-danger" /> Full</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Private</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Cause</span>
          <span className="flex items-center gap-1"><FiSlash className="h-2.5 w-2.5" /> No game</span>
        </div>
      ) : (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> Open</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Filling up</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> Full</span>
        <span className="flex items-center gap-1"><FiHeart className="text-rose-500" /> For a cause</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" /> Private game booked</span>
        <span className="flex items-center gap-1"><FiSlash /> No game</span>
        <span>Tap a day for details.</span>
        {editable ? <span>Tap any upcoming day to make it a game for a cause or mark it as no game.</span> : null}
      </div>
      )}

      {openDate ? (
        <DayDialog
          dateISO={openDate}
          todayISO={todayISO}
          capacity={capacityByDate[openDate]}
          cause={causeByDate[openDate]}
          closed={closedByDate[openDate]}
          editable={editable}
          onClose={() => setOpenDate(null)}
          onChanged={() => { void reload() }}
        />
      ) : null}
    </div>
  )
}

function DayDialog({ dateISO, todayISO, capacity, cause, closed, editable, onClose, onChanged }: {
  dateISO: string
  todayISO: string
  capacity?: WeekendDay
  cause?: CauseDay
  closed?: ClosedDay
  editable: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const past = dateISO < todayISO
  const canEdit = editable && !past
  const [form, setForm] = useState({
    title: cause?.title || '',
    beneficiary: cause?.beneficiary || '',
    description: cause?.description || '',
    donationPercent: String(cause?.donationPercent ?? 100),
  })
  const [closeReason, setCloseReason] = useState(closed?.reason || '')
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  // Bookings already on this day; closing it doesn't cancel them.
  const publicDay = Boolean(capacity && isPublicDay(capacity))
  const bookedPlayers = publicDay ? capacity?.booked || 0 : 0
  const privateGroups = !publicDay ? capacity?.groups || 0 : 0

  const closeDay = async () => {
    setSaving(true)
    try {
      const res = await apiPut<{ ok: boolean; activeBookings?: number }>(`/api/closed-days/${dateISO}`, { reason: closeReason })
      const active = Number(res?.activeBookings || 0)
      if (closed) toast.success('Reason updated')
      else if (active > 0) {
        toast(`No games on this day. ${active} existing booking${active === 1 ? ' is' : 's are'} still on it: reschedule or cancel ${active === 1 ? 'it' : 'them'} in Reservations.`, { icon: '⚠️', duration: 8000 })
      } else toast.success('Marked as no game')
      onChanged()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Could not save')
      setSaving(false)
    }
  }

  const reopenDay = async () => {
    setSaving(true)
    try {
      await apiPost(`/api/closed-days/${dateISO}/remove`, {})
      toast.success('Games are back on for this day')
      onChanged()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Could not reopen it')
      setSaving(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await apiPut(`/api/cause-days/${dateISO}`, { ...form, donationPercent: Number(form.donationPercent) })
      toast.success(cause ? 'Game for a cause updated' : 'Day marked as a game for a cause')
      onChanged()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await apiPost(`/api/cause-days/${dateISO}/remove`, {})
      toast.success('Back to a regular game day')
      onChanged()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove it')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={longDate(dateISO)}
      eyebrow={closed ? 'No game' : cause ? 'Game for a cause' : publicDay ? 'Public game day' : 'Private game day'}
      size="md"
      onClose={saving ? () => {} : onClose}
      footer={canEdit && !closed ? (
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={saving || !form.title.trim()} onClick={save}>
            <FiHeart /> {saving ? 'Saving…' : cause ? 'Save changes' : 'Make it a game for a cause'}
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        {closed && !canEdit ? (
          <div className="rounded-2xl border border-dashed border-[rgba(var(--text),0.2)] bg-[rgba(var(--text),0.04)] p-4 text-sm">
            <div className="flex items-center gap-2 font-bold"><FiSlash /> No games this day</div>
            {closed.reason ? <p className="mt-1 text-sm text-muted">{closed.reason}</p> : null}
          </div>
        ) : null}

        {canEdit ? (
          <div className="space-y-3 rounded-2xl border border-dashed border-[rgba(var(--text),0.2)] bg-[rgba(var(--text),0.03)] p-4">
            <div className="flex items-center gap-2 text-sm font-bold"><FiSlash /> No game on this day</div>
            {cause && !closed ? (
              <p className="text-xs text-muted">This day is a game for a cause. Remove the cause below first to mark it as no game.</p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  {closed
                    ? "Players can't book, hold, or reschedule onto this day."
                    : "Players won't be able to book, hold, or reschedule onto this day. Existing bookings are not cancelled."}
                </p>
                <Input
                  label="Reason (optional, shown to players)"
                  placeholder="e.g. Field maintenance, Holiday"
                  maxLength={200}
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                />
                {!closed && (bookedPlayers > 0 || privateGroups > 0) ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    This day already has bookings ({bookedPlayers > 0 ? `${bookedPlayers} player${bookedPlayers === 1 ? '' : 's'}` : `${privateGroups} private group${privateGroups === 1 ? '' : 's'}`}). Marking it as no game won't cancel them; move or cancel them in Reservations.
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {closed ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={saving || closeReason.trim() === (closed.reason || '')} onClick={closeDay}>Save reason</Button>
                      <Button size="sm" variant="primary" disabled={saving} onClick={reopenDay}><FiCalendar /> Reopen for games</Button>
                    </>
                  ) : confirmClose ? (
                    <>
                      <Button size="sm" variant="danger" disabled={saving} onClick={closeDay}><FiSlash /> Yes, no game this day</Button>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmClose(false)}>Cancel</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="danger-soft" disabled={saving} onClick={() => setConfirmClose(true)}><FiSlash /> Mark as no game</Button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}

        {cause && !canEdit ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-bold text-rose-600 dark:text-rose-400"><FiHeart /> {cause.title}</div>
            {cause.beneficiary ? <div className="mt-1 text-xs text-muted">For {cause.beneficiary}</div> : null}
            {cause.description ? <p className="mt-2 text-sm">{cause.description}</p> : null}
            <div className="mt-2 text-xs text-muted">{cause.donationPercent}% of bookings for this day go to the donation.</div>
          </div>
        ) : null}

        {canEdit && !closed ? (
          <div className="space-y-3 rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-bold"><FiHeart className="text-rose-500" /> Game for a cause</div>
            <p className="text-xs text-muted">
              Players see this on the landing page and when they hover the date in Book a game. Reports count the share of that day's bookings reserved for the donation.
            </p>
            <Input label="Cause" placeholder="e.g. Typhoon relief drive" maxLength={80} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <Input label="Beneficiary (optional)" placeholder="e.g. Brgy. Salawag evacuees" maxLength={120} value={form.beneficiary} onChange={(e) => setForm((f) => ({ ...f, beneficiary: e.target.value }))} />
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Details (optional)</div>
              <textarea
                rows={3}
                maxLength={500}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/60"
              />
            </label>
            <Input
              label="Share of bookings for the donation (%)"
              type="number"
              min={1}
              max={100}
              value={form.donationPercent}
              onChange={(e) => setForm((f) => ({ ...f, donationPercent: e.target.value }))}
              hint="100% gives everything paid for that day's bookings."
            />
            {cause ? (
              confirmRemove ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" disabled={saving} onClick={remove}><FiTrash2 /> Yes, make it a regular day</Button>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmRemove(false)}>Keep it</Button>
                </div>
              ) : (
                <Button size="sm" variant="danger-soft" disabled={saving} onClick={() => setConfirmRemove(true)}><FiTrash2 /> Remove game for a cause</Button>
              )
            ) : null}
          </div>
        ) : editable && past && !cause && !closed ? (
          <div className="text-xs text-muted">Past days can't be made a game for a cause.</div>
        ) : null}

        {capacity ? <DaySlotsTable day={capacity} past={past} /> : (
          <div className="text-xs text-muted">Weekdays are private games for your own group.</div>
        )}
      </div>
    </Modal>
  )
}
