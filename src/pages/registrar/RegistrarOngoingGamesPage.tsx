import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArchive, FiCheck, FiClock, FiChevronRight, FiMapPin, FiSearch, FiShield, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'
import { DEFAULT_PAGE_SIZE, Pagination } from '../../components/ui/Pagination'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

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
const gameDayOf = (doc: GameplayDoc) => {
  const day = String(doc.Schedule || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

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
  mode: string
  search: string
  sort: 'soonest' | 'latest' | 'newest'
}

const DEFAULT_FILTERS: GameFilters = { status: 'active', date: 'any', onDate: '', fromDate: '', toDate: '', slot: '', mode: '', search: '', sort: 'soonest' }

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
  if (filters.mode) and.push({ Mode: filters.mode })

  const term = filters.search.trim()
  if (term) {
    const pattern = { $regex: escapeRegex(term), $options: 'i' }
    and.push({ $or: ['id', 'reservationId', 'Game', 'Schedule', 'Mode', 'Group', 'Package', 'Notes', 'LayoutRequest'].map((field) => ({ [field]: pattern })) })
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

export function RegistrarOngoingGamesPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<GameplayDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<GameFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ Scheduled: 0, Ongoing: 0, Completed: 0, Cancelled: 0, Archived: 0 })
  const { addNotification } = useNotifications()
  const setFilter = <K extends keyof GameFilters>(key: K, value: GameFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }
  const filtersActive = JSON.stringify({ ...filters, sort: DEFAULT_FILTERS.sort }) !== JSON.stringify(DEFAULT_FILTERS)

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
      setItems(Array.isArray(res?.data) ? res.data : [])
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

  const filtered = items
  const pageCount = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))

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
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'gameplay_status_updated',
        title: 'Gameplay Status Updated',
        message: `Gameplay ${id} moved to ${nextStatus}.`,
        linkedResourceId: id,
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
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'gameplay_status_updated',
        title: 'Gameplay Archived',
        message: `Gameplay ${id} was archived.`,
        linkedResourceId: id,
      })
      toast.success('Gameplay archived')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Scheduled</div>
          <div className="mt-2 text-2xl font-bold text-accent">{counts.Scheduled}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Ongoing</div>
          <div className="mt-2 text-2xl font-bold text-success">{counts.Ongoing}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Completed</div>
          <div className="mt-2 text-2xl font-bold text-success">{counts.Completed}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Cancelled</div>
          <div className="mt-2 text-2xl font-bold text-danger">{counts.Cancelled}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Archived</div>
          <div className="mt-2 text-2xl font-bold text-muted">{counts.Archived}</div>
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
                placeholder="Search ID, reservation, game, mode, group, package, notes"
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span>{loading ? 'Loading…' : `${total} game${total === 1 ? '' : 's'} match`}</span>
          {filtersActive ? (
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setFilters({ ...DEFAULT_FILTERS, sort: filters.sort }); setPage(1) }}>
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Game</th>
                <th className="py-2 pr-3">Schedule</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Group</th>
                <th className="py-2 pr-3">Package</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-6 text-sm text-muted">
                    Loading gameplay…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-sm text-muted">
                    {filtersActive ? 'No games match these filters.' : 'No gameplay records.'}
                  </td>
                </tr>
              ) : (
                filtered.map((doc) => {
                  const status = normalizeStatus(doc.Status)
                  const gameDay = gameDayOf(doc)
                  const beforeGameDay = Boolean(gameDay) && gameDay > manilaToday()
                  return (
                    <tr key={rowId(doc)} className="border-t border-white/5">
                      <td className="py-3 pr-3">
                        <div className="font-bold">{rowId(doc) || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Game || '—'}</div>
                        <div className="mt-1 text-xs text-muted flex items-center gap-2">

                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Schedule || '—'}</div>
                        <div className="mt-1 text-xs text-muted flex items-center gap-2">
                          <FiClock /> {doc.createdAtISO || '—'}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Mode || '—'}</div>
                        {doc.LayoutRequest ? <div className="mt-1 max-w-[220px] text-xs text-muted">Layout: {doc.LayoutRequest}</div> : null}
                        {doc.LayoutBlueprintUrl ? (
                          <a href={doc.LayoutBlueprintUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-accent hover:underline">
                            View layout blueprint
                          </a>
                        ) : null}
                        {doc.Notes ? <div className="mt-1 max-w-[220px] text-xs text-muted">Notes: {doc.Notes}</div> : null}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Group || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Package || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          {status === 'Scheduled' && beforeGameDay ? (
                            <span className="text-xs text-muted">Starts on {gameDay}</span>
                          ) : null}
                          {status === 'Scheduled' && !beforeGameDay ? (
                            <Button variant="primary" className="w-full sm:w-auto" onClick={() => startGame(doc)}>
                              Start
                              <FiChevronRight />
                            </Button>
                          ) : null}
                          {status === 'Ongoing' ? (
                            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => completeGame(doc)}>
                              Complete
                              <FiCheck />
                            </Button>
                          ) : null}
                          {status === 'Completed' ? (
                            <Button variant="ghost" className="w-full sm:w-auto border-accent/30 text-accent" onClick={() => archiveGame(doc)}>
                              <FiArchive />
                              Archive
                            </Button>
                          ) : null}
                          {status === 'Archived' ? <span className="text-xs text-muted italic">In game history</span> : null}
                          {status === 'Cancelled' ? <span className="text-xs text-muted italic">No actions</span> : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
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
    </div>
    
  )
}
