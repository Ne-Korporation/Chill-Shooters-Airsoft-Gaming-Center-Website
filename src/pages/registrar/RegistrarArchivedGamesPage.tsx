import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArchive, FiArrowLeft, FiChevronDown, FiFolder, FiFolderMinus, FiSearch, FiShield, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGetAll } from '../../utils/apiClient'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { DAYS_PER_PAGE, folderLabel, gameDayOf, locationName, slotOf } from './RegistrarOngoingGamesPage'

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
  Status?: GameplayStatus | string
  archivedAtISO?: string
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

function rowId(doc: GameplayDoc) {
  // Priority: gameplay's own `id` (GP-XXXXX) → MongoDB `_id` → reservationId
  const gameplayId = doc.id ? String(doc.id).trim() : null
  if (gameplayId) return gameplayId

  // Fall back to MongoDB _id (handle both ObjectId and string forms)
  const mongoId = doc._id
  if (mongoId) {
    if (typeof mongoId === 'string') return mongoId.trim()
    if (typeof mongoId === 'object' && mongoId.$oid) return String(mongoId.$oid).trim()
    try { return String(mongoId) } catch { /* fall through */ }
  }

  return String(doc.reservationId || '')
}

// `embedded`: shown as a tab inside the admin Bookings page, which supplies the title and tabs.
export function RegistrarArchivedGamesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [items, setItems] = useState<GameplayDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  // Only the first load shows "Loading"; the 10-second refreshes update the list quietly
  // (they used to flash the loading state and pop up an error on every failed try).
  const loadedOnce = React.useRef(false)
  const refresh = async () => {
    const silent = loadedOnce.current
    if (!silent) setLoading(true)
    try {
      const docs = await apiGetAll<GameplayDoc>('gameplay', 'sort=' + encodeURIComponent(JSON.stringify({ Schedule: -1 })))
      setItems(docs)
      loadedOnce.current = true
    } catch (e: any) {
      if (silent) return
      toast.error(String(e?.message || e))
      setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    refresh()

    const handleFocus = () => {
      void refresh()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 10000)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  const archivedItems = useMemo(() => {
    return items.filter((doc) => normalizeStatus(doc.Status) === 'Archived')
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return archivedItems
    return archivedItems.filter((doc) => {
      const haystack = [doc.id, doc._id, doc.Location, doc.Schedule, doc.Mode, doc.Group, doc.Package, doc.Status, doc.reservationId]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(q)
    })
  }, [archivedItems, query])

  // One folder per game day (newest first, as loaded), paged by day like the game queue so a day's
  // games are never split across pages.
  const folders = useMemo(() => {
    const byDay = new Map<string, GameplayDoc[]>()
    for (const doc of filtered) {
      const day = gameDayOf(doc)
      byDay.set(day, [...(byDay.get(day) || []), doc])
    }
    return [...byDay.entries()].map(([day, games]) => ({ day, games }))
  }, [filtered])
  const { page, setPage, pageCount, pageItems: pageFolders, total } = usePagination(folders, DAYS_PER_PAGE, query)

  // The newest day starts open; searching opens every matching day.
  const [folderToggles, setFolderToggles] = useState<Record<string, boolean>>({})
  const folderOpen = (day: string) => folderToggles[day] ?? (Boolean(query.trim()) || day === folders[0]?.day)
  const toggleFolder = (day: string) => setFolderToggles((current) => ({ ...current, [day]: !folderOpen(day) }))

  return (
    <div className="space-y-4">
      {!embedded ? (
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-accent">Games</div>
          <h1 className="text-3xl font-bold">Archived Games</h1>
          <p className="text-muted text-sm">Completed games that have been archived to the game history.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/app/games/ongoing')}>
          <FiArrowLeft />
          Ongoing Games
        </Button>
      </div>
      ) : null}

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiArchive /> <span>Game history</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              {archivedItems.length} archived game{archivedItems.length !== 1 ? 's' : ''} in total.
            </div>
          </div>

          <div className="md:w-[420px]">
            <div className="relative">
              <FiSearch className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search archived games…"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-10 py-3 text-sm outline-none focus:border-accent/40"
              />
              {query.trim() ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-3 rounded-xl p-2 text-muted hover:bg-white/5 hover:text-text"
                  aria-label="Clear search"
                >
                  <FiX />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Archived games grouped into a folder per game date. */}
        <div className="mt-5 space-y-2">
          {loading ? (
            <div className="py-6 text-sm text-muted">Loading archived games…</div>
          ) : folders.length === 0 ? (
            <div className="py-6 text-sm text-muted">
              {query.trim() ? 'No archived games match your search.' : 'No archived games yet. Complete and archive games from the ongoing view.'}
            </div>
          ) : (
            pageFolders.map((folder) => {
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
                      <div className="text-xs text-muted">{folder.games.length} archived game{folder.games.length === 1 ? '' : 's'}</div>
                    </div>
                    <FiChevronDown className={['shrink-0 text-muted transition-transform', isOpen ? 'rotate-180' : ''].join(' ')} />
                  </button>
                  {isOpen ? (
                    <ul className="divide-y divide-white/5 border-t border-white/10">
                      {folder.games.map((doc) => (
                        <li key={rowId(doc)} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold">{slotOf(doc)} · {locationName(doc)}</div>
                            <div className="text-xs text-muted">
                              {[rowId(doc) || '—', doc.Mode, doc.Group, doc.Package].filter((value) => value && value !== '—').join(' · ')}
                            </div>
                          </div>
                          <div className="text-xs text-muted sm:text-right">
                            Archived {doc.archivedAtISO ? new Date(doc.archivedAtISO).toLocaleString() : '—'}
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
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={DAYS_PER_PAGE} noun="days" onPageChange={setPage} />
      </Card>
    </div>
  )
}

