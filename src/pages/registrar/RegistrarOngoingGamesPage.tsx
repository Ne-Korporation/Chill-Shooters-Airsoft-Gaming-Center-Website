import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { FiArchive, FiCheck, FiChevronDown, FiChevronRight, FiEye, FiFolder, FiFolderMinus, FiMapPin, FiSearch, FiShield, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { apiGet, apiPut } from '../../utils/apiClient'
import { DEFAULT_PAGE_SIZE, Pagination } from '../../components/ui/Pagination'
import { useAuth } from '../../context/AuthContext'
import { LOCATIONS } from '../operations/shared'
import { BookingPlayersSection } from '../../components/reservations/BookingPlayersSection'

type GameplayStatus = 'Scheduled' | 'Ongoing' | 'Completed' | 'Cancelled' | 'Archived'

type GameplayDoc = {
  id?: string
  _id?: any
  reservationId?: string
  Game?: string
  Schedule?: string
  Mode?: string
  Group?: string
  Package?: string
  LocationId?: string
  Location?: string
  LayoutRequest?: string
  LayoutBlueprintUrl?: string
  Notes?: string
  Status?: GameplayStatus | string
  createdAtISO?: string
  updatedAtISO?: string
}

const normalizeStatus = (value: any): GameplayStatus => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.includes('arch')) return 'Archived'
  if (raw.includes('ongo')) return 'Ongoing'
  if (raw.includes('compl')) return 'Completed'
  if (raw.includes('cancel')) return 'Cancelled'
  return 'Scheduled'
}

// Game day from a "YYYY-MM-DD • slot" schedule, or '' when it can't be read.
const gameDayOf = (doc: { Schedule?: string }) => {
  const day = String(doc.Schedule || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

// "2026-11-03 • morning" → "November 03, 2026 · Morning".
export const formatSchedule = (doc: { Schedule?: string }) => {
  const day = gameDayOf(doc)
  if (!day) return doc.Schedule || '—'
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
  const slot = String(doc.Schedule || '').split('•')[1]?.trim() || ''
  return slot ? `${date} · ${slot.charAt(0).toUpperCase()}${slot.slice(1)}` : date
}

// Folder heading for a game date: "Today · Sat, Nov 7", "Tomorrow · …", or "Mon, Nov 9, 2026".
const folderLabel = (day: string) => {
  if (!day) return 'No date'
  const today = manilaToday()
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (day === today) return `Today · ${label}`
  if (day === addDays(today, 1)) return `Tomorrow · ${label}`
  if (day === addDays(today, -1)) return `Yesterday · ${label}`
  return label
}

// "2026-11-03 • morning" → "Morning".
const slotOf = (doc: { Schedule?: string }) => {
  const slot = String(doc.Schedule || '').split('•')[1]?.trim() || ''
  return slot ? `${slot.charAt(0).toUpperCase()}${slot.slice(1)}` : 'No slot'
}

const STATUS_ORDER: GameplayStatus[] = ['Ongoing', 'Scheduled', 'Completed', 'Cancelled', 'Archived']

export const locationName =(doc: { LocationId?: string; Location?: string }) =>
  LOCATIONS.find((loc) => loc.id === doc.LocationId)?.name || doc.Location || doc.LocationId || '—'

type GameWeapon = {
  id: string
  name: string
  unitNumber: number
  status: string
  source: 'rental' | 'own'
  rentedTo: string
  rentalStatus: string
}

const WEAPON_STATUS_LABELS: Record<string, string> = { available: 'Available', rented: 'Rented', 'needs-check': 'Needs check', removed: 'Removed' }

const statusTone = (status: GameplayStatus) => {
  switch (status) {
    case 'Ongoing':
      return 'bg-success/20 text-success border-success/30'
    case 'Completed':
      return 'bg-success/20 text-success border-success/30'
    case 'Cancelled':
      return 'bg-danger/20 text-danger border-danger/30'
    case 'Archived':
      return 'bg-white/5 text-muted border-white/10'
    default:
      return 'bg-accent/20 text-accent border-accent/30'
  }
}

function StatusBadge({ status }: { status: GameplayStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
      {status.toUpperCase()}
    </span>
  )
}

const GAME_MODES = [
  "Marshal's choice",
  'Team Deathmatch',
  'Capture the Flag',
  'Search & Destroy (bomb defusal)',
  'Domination / King of the Hill',
  'VIP Escort',
  'Attack & Defend',
]

type StatusFilter = 'active' | 'Scheduled' | 'Ongoing' | 'Completed' | 'Cancelled'
type DateFilter = 'any' | 'today' | 'tomorrow' | 'week' | 'upcoming' | 'past' | 'on' | 'range'
type GameFilters = {
  status: StatusFilter
  date: DateFilter
  onDate: string
  fromDate: string
  toDate: string
  slot: string
  location: string
  mode: string
  search: string
  sort: 'soonest' | 'latest' | 'newest'
}

const DEFAULT_FILTERS: GameFilters = { status: 'active', date: 'any', onDate: '', fromDate: '', toDate: '', slot: '', location: '', mode: '', search: '', sort: 'soonest' }

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Turns the filter bar into a MongoDB query so the server filters and pages the whole gameplay
// collection; a match on any page is found, not just among the rows on screen.
// Schedule is stored as "YYYY-MM-DD • slot", so dates compare as text.
function buildGameQuery(filters: GameFilters) {
  const today = manilaToday()
  const and: Record<string, unknown>[] = []
  and.push(filters.status === 'active'
    ? { Status: { $not: { $regex: 'arch', $options: 'i' } } }
    : { Status: { $regex: `^${filters.status}`, $options: 'i' } })

  const dayRange = (from: string, toExclusive: string) => and.push({ Schedule: { $gte: from, $lt: toExclusive } })
  if (filters.date === 'today') dayRange(today, addDays(today, 1))
  if (filters.date === 'tomorrow') dayRange(addDays(today, 1), addDays(today, 2))
  if (filters.date === 'week') dayRange(today, addDays(today, 7))
  if (filters.date === 'upcoming') and.push({ Schedule: { $gte: today } })
  if (filters.date === 'past') and.push({ Schedule: { $lt: today } })
  if (filters.date === 'on' && filters.onDate) dayRange(filters.onDate, addDays(filters.onDate, 1))
  if (filters.date === 'range' && (filters.fromDate || filters.toDate)) {
    and.push({ Schedule: { ...(filters.fromDate ? { $gte: filters.fromDate } : {}), ...(filters.toDate ? { $lt: addDays(filters.toDate, 1) } : {}) } })
  }
  if (filters.slot) and.push({ Schedule: { $regex: `${filters.slot}$`, $options: 'i' } })
  if (filters.location) and.push({ LocationId: filters.location })
  if (filters.mode) and.push({ Mode: filters.mode })

  const term = filters.search.trim()
  if (term) {
    const pattern = { $regex: escapeRegex(term), $options: 'i' }
    and.push({ $or: ['id', 'reservationId', 'Schedule', 'Location', 'Mode', 'Group', 'Package', 'Notes', 'LayoutRequest'].map((field) => ({ [field]: pattern })) })
  }
  const sort = filters.sort === 'newest' ? { createdAtISO: -1 } : { Schedule: filters.sort === 'soonest' ? 1 : -1 }
  return { q: { $and: and }, sort }
}

function rowId(doc: GameplayDoc) {
  // Priority: gameplay's own `id` (GP-XXXXX) → MongoDB `_id` → reservationId
  // The `id` field is the most reliable for API lookups since crud.js first
  // tries findOne({ id: ... }) which matches the gameplay's own id string.
  const gameplayId = doc.id ? String(doc.id).trim() : null
  if (gameplayId) return gameplayId

  // Fall back to MongoDB _id (handle both ObjectId and string forms)
  const mongoId = doc._id
  if (mongoId) {
    if (typeof mongoId === 'string') return mongoId.trim()
    // If it's an object (e.g. {$oid: "..."}), try to extract the hex string
    if (typeof mongoId === 'object' && mongoId.$oid) return String(mongoId.$oid).trim()
    try { return String(mongoId) } catch { /* fall through */ }
  }

  return String(doc.reservationId || '')
}

// `embedded`: shown as a tab inside the admin Bookings page, which supplies the title and tabs.
export function RegistrarOngoingGamesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [items, setItems] = useState<GameplayDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<GameFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ Scheduled: 0, Ongoing: 0, Completed: 0, Cancelled: 0, Archived: 0 })
  const { user } = useAuth()
  const canUpdateWeapons = user?.role === 'admin' || user?.role === 'marshal'
  // The game whose details pop-up is open; the row is re-read from the list after each refresh.
  const [detail, setDetail] = useState<GameplayDoc | null>(null)
  const detailDoc = detail ? items.find((doc) => rowId(doc) === rowId(detail)) || detail : null
  const [weapons, setWeapons] = useState<GameWeapon[] | null>(null)
  const [updatingWeaponId, setUpdatingWeaponId] = useState('')

  const loadWeapons = React.useCallback(async (reservationId: string) => {
    try {
      const res = await apiGet<{ ok: boolean; data: GameWeapon[] }>(`/api/reservations/${encodeURIComponent(reservationId)}/weapons`)
      setWeapons(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setWeapons([])
    }
  }, [])

  const openDetails = (doc: GameplayDoc) => {
    setDetail(doc)
    setWeapons(null)
    if (doc.reservationId) void loadWeapons(doc.reservationId)
    else setWeapons([])
  }

  const setWeaponStatus = async (weapon: GameWeapon, status: 'available' | 'needs-check') => {
    setUpdatingWeaponId(weapon.id)
    try {
      await apiPut(`/api/weapons/${encodeURIComponent(weapon.id)}`, { status, updatedAtISO: new Date().toISOString() })
      toast.success(`${weapon.name} marked ${status === 'available' ? 'available' : 'for a check'}`)
      if (detailDoc?.reservationId) await loadWeapons(detailDoc.reservationId)
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setUpdatingWeaponId('')
    }
  }

  const setFilter =<K extends keyof GameFilters>(key: K, value: GameFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }
  const filtersActive = JSON.stringify({ ...filters, sort: DEFAULT_FILTERS.sort }) !== JSON.stringify(DEFAULT_FILTERS)
  // Time slot, game mode and sort sit behind "More filters"; they stay visible while one is set.
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const moreFiltersSet = Boolean(filters.slot || filters.mode || filters.sort !== DEFAULT_FILTERS.sort)
  const showMoreFilters = moreFiltersOpen || moreFiltersSet

  // Latest filters/page for the background refresh.
  const latest = React.useRef({ filters, page })
  latest.current = { filters, page }

  const refresh = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { filters: current, page: currentPage } = latest.current
    const { q, sort } = buildGameQuery(current)
    const params = `q=${encodeURIComponent(JSON.stringify(q))}&sort=${encodeURIComponent(JSON.stringify(sort))}&limit=${DEFAULT_PAGE_SIZE}&skip=${(currentPage - 1) * DEFAULT_PAGE_SIZE}&withTotal=1`
    try {
      const [res, ...statusTotals] = await Promise.all([
        apiGet<{ ok: boolean; data: GameplayDoc[]; total?: number }>(`/api/gameplay?${params}`),
        ...(['Scheduled', 'Ongoing', 'Completed', 'Cancelled', 'Archived'] as const).map((status) =>
          apiGet<{ ok: boolean; total?: number }>(`/api/gameplay?q=${encodeURIComponent(JSON.stringify({ Status: { $regex: `^${status.slice(0, 4)}`, $options: 'i' } }))}&limit=1&withTotal=1`)
            .then((r) => Number(r?.total || 0)).catch(() => 0)),
      ])
      const docs = Array.isArray(res?.data) ? res.data : []
      // Games recorded before locations were stored on them: read the location from the booking
      // (the server also fills these in when it starts).
      const missing = [...new Set(docs.filter((doc) => !doc.LocationId && doc.reservationId).map((doc) => String(doc.reservationId)))]
      if (missing.length) {
        const bookings = await apiGet<{ ok: boolean; data: Array<{ id?: string; locationId?: string; locationName?: string }> }>(
          `/api/reservations?q=${encodeURIComponent(JSON.stringify({ id: { $in: missing } }))}&limit=${missing.length}`,
        ).catch(() => null)
        const byId = new Map((bookings?.data || []).map((booking) => [String(booking.id), booking]))
        for (const doc of docs) {
          const booking = !doc.LocationId ? byId.get(String(doc.reservationId)) : undefined
          if (booking) Object.assign(doc, { LocationId: booking.locationId, Location: booking.locationName })
        }
      }
      setItems(docs)
      setTotal(Number(res?.total || 0))
      setCounts({ Scheduled: statusTotals[0], Ongoing: statusTotals[1], Completed: statusTotals[2], Cancelled: statusTotals[3], Archived: statusTotals[4] })
    } catch (e: any) {
      if (!silent) toast.error(String(e?.message || e))
      if (!silent) setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Search waits for a pause in typing; every other filter applies at once.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), filters.search ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [filters, page, refresh])

  useEffect(() => {

    const handleFocus = () => {
      void refresh(true)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh(true)
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalId = window.setInterval(() => {
      void refresh(true)
    }, 10000)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [refresh])

  useLiveRefresh(['reservations', 'games', 'payments', 'gear'], () => refresh(true))

  const pageCount = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))

  // This page's games in one folder per game date, in the order the server sorted them.
  const folders = useMemo(() => {
    const byDay = new Map<string, GameplayDoc[]>()
    for (const doc of items) {
      const day = gameDayOf(doc)
      byDay.set(day, [...(byDay.get(day) || []), doc])
    }
    return [...byDay.entries()].map(([day, games]) => {
      const statusCounts: Partial<Record<GameplayStatus, number>> = {}
      for (const doc of games) {
        const s = normalizeStatus(doc.Status)
        statusCounts[s] = (statusCounts[s] || 0) + 1
      }
      return { day, games, statusCounts }
    })
  }, [items])

  // Today's folder (or the first one when there are no games today) starts open; any folder
  // can be opened or closed, and that choice is kept while the list refreshes.
  const [folderToggles, setFolderToggles] = useState<Record<string, boolean>>({})
  const defaultOpenDay = folders.some((f) => f.day === manilaToday()) ? manilaToday() : folders[0]?.day
  const folderOpen = (day: string) => folderToggles[day] ?? day === defaultOpenDay
  const toggleFolder = (day: string) => setFolderToggles((current) => ({ ...current, [day]: !folderOpen(day) }))

  const updateStatus = async (doc: GameplayDoc, nextStatus: GameplayStatus) => {
    const id = rowId(doc)
    if (!id) return toast.error('Missing gameplay id')

    try {
      await apiPut(`/api/gameplay/${encodeURIComponent(id)}`, {
        $set: {
          Status: nextStatus,
          updatedAtISO: new Date().toISOString(),
        },
      })
      toast.success(`Gameplay marked ${nextStatus.toLowerCase()}`)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const startGame = async (doc: GameplayDoc) => updateStatus(doc, 'Ongoing')
  const completeGame = async (doc: GameplayDoc) => updateStatus(doc, 'Completed')

  const archiveGame = async (doc: GameplayDoc) => {
    const status = normalizeStatus(doc.Status)
    if (status !== 'Completed') {
      toast.error('Only completed games can be archived')
      return
    }

    const id = rowId(doc)
    if (!id) return toast.error('Missing gameplay id')

    const confirmed = window.confirm('Archive this completed game? It will move to the game history.')
    if (!confirmed) return

    try {
      await apiPut(`/api/gameplay/${encodeURIComponent(id)}`, {
        $set: {
          Status: 'Archived',
          archivedAtISO: new Date().toISOString(),
          updatedAtISO: new Date().toISOString(),
        },
      })
      toast.success('Gameplay archived')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
      {!embedded ? (
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-accent">Games</div>
          <h1 className="text-3xl font-bold">Ongoing Games</h1>
          <p className="text-muted text-sm">Confirmed reservations appear here as gameplay records with start, complete, and archive actions.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/app/games/archived')}>
          <FiArchive />
          Archived Games
        </Button>
      </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Scheduled</div>
          <div className="mt-0.5 text-base font-bold text-accent">{counts.Scheduled}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Ongoing</div>
          <div className="mt-0.5 text-base font-bold text-success">{counts.Ongoing}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Completed</div>
          <div className="mt-0.5 text-base font-bold text-success">{counts.Completed}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Cancelled</div>
          <div className="mt-0.5 text-base font-bold text-danger">{counts.Cancelled}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Archived</div>
          <div className="mt-0.5 text-base font-bold text-muted">{counts.Archived}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Game queue</span>
            </div>
          </div>

          <div className="md:w-[420px]">
            <div className="relative">
              <FiSearch className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                placeholder="Search ID, reservation, location, mode, group, package, notes"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-10 py-3 text-sm outline-none focus:border-accent/40"
              />
              {filters.search.trim() ? (
                <button
                  type="button"
                  onClick={() => setFilter('search', '')}
                  className="absolute right-3 top-3 rounded-xl p-2 text-muted hover:bg-white/5 hover:text-text"
                  aria-label="Clear search"
                >
                  <FiX />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <label className="block text-xs font-semibold text-muted">
            Status
            <select value={filters.status} onChange={(e) => setFilter('status', e.target.value as StatusFilter)} className="select-field mt-1 h-10 w-full">
              <option value="active">All (not archived)</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Ongoing">Ongoing</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            Game date
            <select value={filters.date} onChange={(e) => setFilter('date', e.target.value as DateFilter)} className="select-field mt-1 h-10 w-full">
              <option value="any">Any date</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="week">Next 7 days</option>
              <option value="upcoming">Today and later</option>
              <option value="past">Before today</option>
              <option value="on">On a date…</option>
              <option value="range">Between dates…</option>
            </select>
          </label>
          {filters.date === 'on' ? (
            <label className="block text-xs font-semibold text-muted">
              On
              <input type="date" value={filters.onDate} onChange={(e) => setFilter('onDate', e.target.value)} className="select-field mt-1 h-10 w-full" />
            </label>
          ) : null}
          {filters.date === 'range' ? (
            <>
              <label className="block text-xs font-semibold text-muted">
                From
                <input type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(e) => setFilter('fromDate', e.target.value)} className="select-field mt-1 h-10 w-full" />
              </label>
              <label className="block text-xs font-semibold text-muted">
                To
                <input type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(e) => setFilter('toDate', e.target.value)} className="select-field mt-1 h-10 w-full" />
              </label>
            </>
          ) : null}
          <label className="block text-xs font-semibold text-muted">
            Location
            <select value={filters.location} onChange={(e) => setFilter('location', e.target.value)} className="select-field mt-1 h-10 w-full">
              <option value="">Any location</option>
              {LOCATIONS.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </label>
        </div>
        {/* Less-used filters, tucked away until asked for (or while one of them is set). */}
        {showMoreFilters ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <label className="block text-xs font-semibold text-muted">
            Time slot
            <select value={filters.slot} onChange={(e) => setFilter('slot', e.target.value)} className="select-field mt-1 h-10 w-full">
              <option value="">Any slot</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            Game mode
            <select value={filters.mode} onChange={(e) => setFilter('mode', e.target.value)} className="select-field mt-1 h-10 w-full">
              <option value="">Any mode</option>
              {GAME_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            Sort by
            <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as GameFilters['sort'])} className="select-field mt-1 h-10 w-full">
              <option value="soonest">Game date (earliest first)</option>
              <option value="latest">Game date (latest first)</option>
              <option value="newest">Recently added</option>
            </select>
          </label>
        </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
          <span>{loading ? 'Loading…' : `${total} game${total === 1 ? '' : 's'} match`}</span>
          <div className="flex items-center gap-4">
            {!moreFiltersSet ? (
              <button type="button" className="-my-2 py-2 font-semibold text-accent hover:underline" onClick={() => setMoreFiltersOpen((v) => !v)}>
                {moreFiltersOpen ? 'Fewer filters' : 'More filters'}
              </button>
            ) : null}
            {filtersActive ? (
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setFilters({ ...DEFAULT_FILTERS, sort: filters.sort }); setPage(1) }}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {/* Games grouped into a folder per game date. */}
        <div className="mt-5 space-y-2">
          {loading ? (
            <div className="py-6 text-sm text-muted">Loading gameplay…</div>
          ) : folders.length === 0 ? (
            <div className="py-6 text-sm text-muted">{filtersActive ? 'No games match these filters.' : 'No gameplay records.'}</div>
          ) : (
            folders.map((folder) => {
              const isOpen = folderOpen(folder.day)
              return (
                <div key={folder.day || 'none'} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.day)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
                  >
                    {isOpen ? <FiFolderMinus className="shrink-0 text-lg text-gold" /> : <FiFolder className="shrink-0 text-lg text-gold" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{folderLabel(folder.day)}</div>
                      <div className="text-xs text-muted">
                        {folder.games.length} game{folder.games.length === 1 ? '' : 's'}
                        {STATUS_ORDER.filter((s) => folder.statusCounts[s]).map((s) => ` · ${folder.statusCounts[s]} ${s.toLowerCase()}`).join('')}
                      </div>
                    </div>
                    <FiChevronDown className={['shrink-0 text-muted transition-transform', isOpen ? 'rotate-180' : ''].join(' ')} />
                  </button>
                  {isOpen ? (
                    <ul className="divide-y divide-white/5 border-t border-white/10">
                      {folder.games.map((doc) => (
                        <li key={rowId(doc)} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold">
                              {slotOf(doc)} · {locationName(doc)}
                            </div>
                            <div className="text-xs text-muted">{rowId(doc) || '—'}{doc.Group ? ` · ${doc.Group}` : ''}</div>
                          </div>
                          <div className="flex items-center justify-between gap-3 sm:justify-end">
                            <StatusBadge status={normalizeStatus(doc.Status)} />
                            <Button size="sm" variant="ghost" onClick={() => openDetails(doc)}>
                              <FiEye /> Game details
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiMapPin className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Workflow</div>
              <div className="mt-1 text-xs text-muted">
                Confirmed reservations create gameplay automatically; the registrar then moves them from Start to Complete and archives completed games to the game history.
              </div>
          </div>
        </div>
    </div>
    </Card>

    {detailDoc ? (
      <GameDetailsDialog
        doc={detailDoc}
        weapons={weapons}
        canUpdateWeapons={canUpdateWeapons}
        updatingWeaponId={updatingWeaponId}
        onWeaponStatus={setWeaponStatus}
        onStart={() => startGame(detailDoc)}
        onComplete={() => completeGame(detailDoc)}
        onArchive={() => archiveGame(detailDoc)}
        onClose={() => setDetail(null)}
      />
    ) : null}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-b-0">
      <div className="text-muted">{label}</div>
      <div className="text-right font-semibold">{children}</div>
    </div>
  )
}

// Everything about one game: the booking behind it (players, rentals, charges and payments),
// package, mode, group, layout, the status actions, and the weapons used, which admins and marshals can mark available again or flag for a check.
function GameDetailsDialog({
  doc,
  weapons,
  canUpdateWeapons,
  updatingWeaponId,
  onWeaponStatus,
  onStart,
  onComplete,
  onArchive,
  onClose,
}: {
  doc: GameplayDoc
  weapons: GameWeapon[] | null
  canUpdateWeapons: boolean
  updatingWeaponId: string
  onWeaponStatus: (weapon: GameWeapon, status: 'available' | 'needs-check') => void
  onStart: () => void
  onComplete: () => void
  onArchive: () => void
  onClose: () => void
}) {
  const status = normalizeStatus(doc.Status)
  const gameDay = gameDayOf(doc)
  const beforeGameDay = Boolean(gameDay) && gameDay > manilaToday()

  const actions = (
    <>
      {status === 'Scheduled' && beforeGameDay ? <span className="self-center text-xs text-muted">Starts on {formatSchedule(doc).split(' · ')[0]}</span> : null}
      {status === 'Scheduled' && !beforeGameDay ? (
        <Button variant="primary" onClick={onStart}>
          Start <FiChevronRight />
        </Button>
      ) : null}
      {status === 'Ongoing' ? (
        <Button variant="ghost" onClick={onComplete}>
          Complete <FiCheck />
        </Button>
      ) : null}
      {status === 'Completed' ? (
        <Button variant="ghost" className="border-accent/30 text-accent" onClick={onArchive}>
          <FiArchive /> Archive
        </Button>
      ) : null}
    </>
  )

  return (
    <Modal eyebrow={`Game ${rowId(doc)}`} title={formatSchedule(doc)} onClose={onClose} footer={actions}>
      {/* Who is playing, and when: from the booking behind this game. */}
      <BookingPlayersSection reservationId={doc.reservationId} detailed />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section>
          <div className="text-xs uppercase tracking-widest text-muted">Game</div>
          <div className="mt-1">
            <DetailRow label="Status"><StatusBadge status={status} /></DetailRow>
            <DetailRow label="Location">{locationName(doc)}</DetailRow>
            <DetailRow label="Package">{doc.Package || '—'}</DetailRow>
            <DetailRow label="Mode">{doc.Mode || '—'}</DetailRow>
            <DetailRow label="Group">{doc.Group || '—'}</DetailRow>
          </div>
        </section>
        <section>
          <div className="text-xs uppercase tracking-widest text-muted">Layout and notes</div>
          <div className="mt-2 space-y-2 text-sm">
            <div>{doc.LayoutRequest ? <>Layout: {doc.LayoutRequest}</> : <span className="text-muted">No layout request.</span>}</div>
            {doc.LayoutBlueprintUrl ? (
              <a href={doc.LayoutBlueprintUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-accent hover:underline">
                View layout blueprint
              </a>
            ) : null}
            <div>{doc.Notes ? <>Notes: {doc.Notes}</> : <span className="text-muted">No notes.</span>}</div>
          </div>
        </section>
      </div>

      <section className="mt-5">
        <div className="text-xs uppercase tracking-widest text-muted">Weapons used</div>
        {weapons === null ? (
          <div className="mt-2 text-sm text-muted">Loading weapons…</div>
        ) : weapons.length === 0 ? (
          <div className="mt-2 text-sm text-muted">No weapons are recorded for this game.</div>
        ) : (
          <ul className="mt-2 divide-y divide-white/5 rounded-2xl border border-white/10">
            {weapons.map((weapon) => {
              const available = weapon.status === 'available'
              return (
                <li key={weapon.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {weapon.name}{weapon.unitNumber ? ` #${weapon.unitNumber}` : ''}
                    </div>
                    <div className="text-[11px] text-muted">
                      {weapon.id} · {weapon.source === 'own' ? "Player's own" : 'Rental'}
                      {weapon.rentedTo ? ` · ${weapon.rentalStatus === 'out' ? 'with' : 'used by'} ${weapon.rentedTo}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${available ? 'border-success/30 bg-success/15 text-success' : weapon.status === 'rented' ? 'border-accent/30 bg-accent/15 text-accent' : 'border-danger/30 bg-danger/15 text-danger'}`}>
                      {WEAPON_STATUS_LABELS[weapon.status] || weapon.status}
                    </span>
                    {canUpdateWeapons && weapon.status !== 'removed' ? (
                      available ? (
                        <Button size="xs" variant="danger-soft" disabled={updatingWeaponId === weapon.id} onClick={() => onWeaponStatus(weapon, 'needs-check')}>
                          <FiX /> Not available
                        </Button>
                      ) : (
                        <Button size="xs" variant="success-soft" disabled={updatingWeaponId === weapon.id} onClick={() => onWeaponStatus(weapon, 'available')}>
                          <FiCheck /> Mark available
                        </Button>
                      )
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </Modal>
  )
}
