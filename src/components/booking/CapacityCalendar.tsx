import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCalendar, FiChevronLeft, FiChevronRight, FiHeart, FiTrash2 } from 'react-icons/fi'
import { apiPost, apiPut, getApiBase } from '../../utils/apiClient'
import { causeDayMessage, type CauseDay } from '../../utils/causeDays'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Bar, DayLocations, fillTone, type WeekendDay } from './WeekendCapacity'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  const [state, setState] = useState<{ loading: boolean; days: WeekendDay[]; causeDays: CauseDay[]; todayISO: string }>({ loading: true, days: [], causeDays: [], todayISO: manilaToday() })
  const load = useCallback(() => {
    return fetch(`${getApiBase()}/api/public/capacity-calendar?month=${encodeURIComponent(month)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => setState({
        loading: false,
        days: Array.isArray(body?.data) ? body.data : [],
        causeDays: Array.isArray(body?.causeDays) ? body.causeDays : [],
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
  title = 'Public game calendar',
  subtitle = 'Weekends are open games anyone can join. Days marked with a heart are games for a cause.',
  editable = false,
  compact = false,
  action,
}: {
  title?: string
  subtitle?: string
  editable?: boolean
  compact?: boolean
  action?: React.ReactNode
}) {
  const [month, setMonth] = useState(() => manilaToday().slice(0, 7))
  const { loading, days, causeDays, todayISO, reload } = useCapacityMonth(month)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const capacityByDate = useMemo(() => Object.fromEntries(days.map((day) => [day.dateISO, day])), [days])
  const causeByDate = useMemo(() => Object.fromEntries(causeDays.map((cause) => [cause.dateISO, cause])), [causeDays])
  const weeks = useMemo(() => monthGrid(month), [month])
  const currentMonth = todayISO.slice(0, 7)

  return (
    <div className={compact ? '' : 'surface rounded-2xl p-5 md:p-6'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className={`${compact ? 'text-sm' : 'text-lg'} flex items-center gap-2 font-bold`}>
            <FiCalendar className="text-accent" /> {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted md:text-sm">{subtitle}</p>
        </div>
        {action}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" aria-label="Previous month" disabled={month <= currentMonth} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          <FiChevronLeft />
        </Button>
        <div className="text-sm font-bold">{monthLabel(month)}</div>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          <FiChevronRight />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-muted">
        {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1">{weekday}</div>)}
      </div>
      <div className={`space-y-1 ${loading ? 'animate-pulse' : ''}`}>
        {weeks.map((week, index) => (
          <div key={index} className="grid grid-cols-7 gap-1">
            {week.map((dateISO, dayIndex) => {
              if (!dateISO) return <div key={`blank-${dayIndex}`} className={compact ? 'h-14' : 'h-16'} />
              const capacity = capacityByDate[dateISO]
              const cause = causeByDate[dateISO]
              const past = dateISO < todayISO
              const tone = capacity ? fillTone(capacity.booked, capacity.capacity) : null
              const clickable = Boolean(capacity || cause || (editable && !past))
              const hint = [
                cause ? causeDayMessage(cause) : '',
                capacity ? `${capacity.booked} of ${capacity.capacity} spots booked` : 'Private bookings only',
              ].filter(Boolean).join(' · ')
              return (
                <button
                  key={dateISO}
                  type="button"
                  title={hint}
                  disabled={!clickable}
                  onClick={() => setOpenDate(dateISO)}
                  className={[
                    `${compact ? 'h-14' : 'h-16'} relative flex flex-col rounded-xl border px-1 py-1 text-left text-[11px] transition`,
                    cause ? 'border-rose-500/40 bg-rose-500/10' : capacity ? 'border-[rgba(var(--text),0.12)] bg-[rgba(var(--text),0.04)]' : 'border-transparent bg-[rgba(var(--text),0.02)]',
                    dateISO === todayISO ? 'ring-2 ring-accent/40' : '',
                    past ? 'opacity-50' : '',
                    clickable ? 'cursor-pointer hover:border-accent/40' : 'cursor-default',
                  ].join(' ')}
                >
                  <span className="flex items-center justify-between font-bold">
                    {Number(dateISO.slice(8))}
                    {cause ? <FiHeart className="h-3 w-3 text-rose-500" aria-label="Game for a cause" /> : null}
                  </span>
                  {capacity ? (
                    <span className="mt-auto">
                      <span className={`block truncate text-[10px] font-semibold ${past ? 'text-muted' : tone?.text}`}>
                        {past ? 'Done' : `${Math.max(0, capacity.capacity - capacity.booked)} left`}
                      </span>
                      <Bar booked={capacity.booked} capacity={capacity.capacity} className="mt-0.5 h-1" />
                    </span>
                  ) : (
                    <span className="mt-auto truncate text-[9px] text-muted/70">{cause ? 'Cause' : 'Private'}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><FiHeart className="text-rose-500" /> Game for a cause</span>
        <span>Weekends: public games · Weekdays: private bookings</span>
        {editable ? <span>Click a day to make it a game for a cause.</span> : null}
      </div>

      {openDate ? (
        <DayDialog
          dateISO={openDate}
          todayISO={todayISO}
          capacity={capacityByDate[openDate]}
          cause={causeByDate[openDate]}
          editable={editable}
          onClose={() => setOpenDate(null)}
          onChanged={() => { void reload() }}
        />
      ) : null}
    </div>
  )
}

function DayDialog({ dateISO, todayISO, capacity, cause, editable, onClose, onChanged }: {
  dateISO: string
  todayISO: string
  capacity?: WeekendDay
  cause?: CauseDay
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
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

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
      eyebrow={cause ? 'Game for a cause' : capacity ? 'Public game day' : 'Private booking day'}
      size="md"
      onClose={saving ? () => {} : onClose}
      footer={canEdit ? (
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={saving || !form.title.trim()} onClick={save}>
            <FiHeart /> {saving ? 'Saving…' : cause ? 'Save changes' : 'Make it a game for a cause'}
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        {cause && !canEdit ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-bold text-rose-600 dark:text-rose-400"><FiHeart /> {cause.title}</div>
            {cause.beneficiary ? <div className="mt-1 text-xs text-muted">For {cause.beneficiary}</div> : null}
            {cause.description ? <p className="mt-2 text-sm">{cause.description}</p> : null}
            <div className="mt-2 text-xs text-muted">{cause.donationPercent}% of bookings for this day go to the donation.</div>
          </div>
        ) : null}

        {canEdit ? (
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
                className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
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
        ) : editable && past && !cause ? (
          <div className="text-xs text-muted">Past days can't be made a game for a cause.</div>
        ) : null}

        {capacity ? (
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Capacity</div>
            <div className="mt-1 text-sm">
              <span className="font-semibold">{capacity.booked.toLocaleString()}</span> of {capacity.capacity.toLocaleString()} spots booked
            </div>
            <Bar booked={capacity.booked} capacity={capacity.capacity} className="mt-2 h-2" />
            <DayLocations day={capacity} />
          </div>
        ) : (
          <div className="text-xs text-muted">Weekdays are private bookings, so there's no public capacity to show.</div>
        )}
      </div>
    </Modal>
  )
}
