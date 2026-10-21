import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArchive, FiArrowLeft, FiClock, FiSearch, FiShield, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'

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

export function RegistrarArchivedGamesPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<GameplayDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: GameplayDoc[] }>('/api/gameplay?limit=200')
      setItems(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setItems([])
    } finally {
      setLoading(false)
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
      const haystack = [doc.id, doc._id, doc.Game, doc.Schedule, doc.Mode, doc.Group, doc.Package, doc.Status, doc.reservationId]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(q)
    })
  }, [archivedItems, query])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-accent">Registrar</div>
          <h1 className="text-3xl font-bold">Archived Games</h1>
          <p className="text-muted text-sm">Completed games that have been archived to the game history.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/app/games/ongoing')}>
          <FiArrowLeft />
          Ongoing Games
        </Button>
      </div>

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
                <th className="py-2 pr-3">Archived At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-sm text-muted">
                    Loading archived games…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-sm text-muted">
                    {query.trim() ? 'No archived games match your search.' : 'No archived games yet. Complete and archive games from the ongoing view.'}
                  </td>
                </tr>
              ) : (
                filtered.map((doc) => {
                  return (
                    <tr key={rowId(doc)} className="border-t border-white/5">
                      <td className="py-3 pr-3">
                        <div className="font-bold">{rowId(doc) || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Game || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Schedule || '—'}</div>
                        <div className="mt-1 text-xs text-muted flex items-center gap-2">
                          <FiClock /> {doc.createdAtISO || '—'}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Mode || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Group || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-bold">{doc.Package || '—'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="text-xs text-muted">{doc.archivedAtISO ? new Date(doc.archivedAtISO).toLocaleString() : '—'}</div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

