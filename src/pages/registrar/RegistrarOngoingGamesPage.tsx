import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArchive, FiCheck, FiClock, FiChevronRight, FiMapPin, FiSearch, FiShield, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'
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
  const [query, setQuery] = useState('')
  const { addNotification } = useNotifications()

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const activeItems = items.filter((doc) => normalizeStatus(doc.Status) !== 'Archived')
    if (!q) return activeItems
    return activeItems.filter((doc) => {
      const haystack = [doc.id, doc._id, doc.Game, doc.Schedule, doc.Mode, doc.Group, doc.Package, doc.Status, doc.reservationId]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(q)
    })
  }, [items, query])

  const counts = useMemo(() => {
    const summary = { Scheduled: 0, Ongoing: 0, Completed: 0, Cancelled: 0, Archived: 0 }
    for (const doc of items) {
      summary[normalizeStatus(doc.Status)]++
    }
    return summary
  }, [items])

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
          <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="uppercase tracking-[0.18em]">Registrar</span>
          </div>
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
            <div className="mt-1 text-xs text-muted">Rows are loaded from the `gameplay` collection.</div>
          </div>

          <div className="md:w-[420px]">
            <div className="relative">
              <FiSearch className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search game, schedule, mode, group, package"
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
                    No gameplay records.
                  </td>
                </tr>
              ) : (
                filtered.map((doc) => {
                  const status = normalizeStatus(doc.Status)
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
                          {status === 'Scheduled' ? (
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
