import React, { useEffect, useMemo, useState } from 'react'
import { FiCheck, FiChevronRight, FiTrash2, FiX } from 'react-icons/fi'
import { toast } from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiDelete, apiGet, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

type GameplayStatus = 'Scheduled' | 'Ongoing' | 'Completed' | 'Cancelled'

type GameplayActions = Record<string, any>

type GameplayDoc = {
  id?: string
  _id?: any
  reservationId: string
  userId?: string
  Game?: string
  Schedule?: string
  Mode?: string
  Group?: string
  Package?: string
  Status: GameplayStatus | string
  Actions?: GameplayActions
  createdAtISO?: string
}

const normalizeStatus = (s: any): GameplayStatus => {
  const raw = String(s || '')
  // Accept common variants.
  const lower = raw.toLowerCase()
  if (lower.includes('sched')) return 'Scheduled'
  if (lower.includes('ongo')) return 'Ongoing'
  if (lower.includes('compl')) return 'Completed'
  if (lower.includes('cancel')) return 'Cancelled'
  return 'Scheduled'
}

const statusTone = (status: GameplayStatus) => {
  switch (status) {
    case 'Scheduled':
      return 'bg-accent/20 text-accent border-accent/30'
    case 'Ongoing':
      return 'bg-success/20 text-success border-success/30'
    case 'Completed':
      return 'bg-success/20 text-success border-success/30'
    case 'Cancelled':
      return 'bg-danger/20 text-danger border-danger/30'
  }
}

const StatusBadge = ({ status }: { status: GameplayStatus }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusTone(status)}`}
    >
      {status.toUpperCase()}
    </span>
  )
}

export function AdminGameplayPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<GameplayDoc[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: GameplayDoc[] }>('/api/gameplay?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []
      setItems(docs)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [nextStatusFilter, setNextStatusFilter] = useState<GameplayStatus | 'all'>('all')

  const filtered = useMemo(() => {
    if (nextStatusFilter === 'all') return items
    return items.filter((it) => normalizeStatus(it.Status) === nextStatusFilter)
  }, [items, nextStatusFilter])

  const canDelete = (status: GameplayStatus) => status === 'Completed'

  const statusOptions: GameplayStatus[] = ['Scheduled', 'Ongoing', 'Completed', 'Cancelled']

  const updateStatus = async (doc: GameplayDoc, status: GameplayStatus) => {
    try {
      if (!doc._id && !doc.id) throw new Error('Missing gameplay id')
      const id = doc._id ? String(doc._id) : doc.id

      await apiPut(`/api/gameplay/${id}`, {
        $set: {
          Status: status,
          updatedAtISO: new Date().toISOString(),
        },
      })

      toast.success('Gameplay updated')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const deleteGameplay = async (doc: GameplayDoc) => {
    try {
      if (!doc._id && !doc.id) throw new Error('Missing gameplay id')
      const id = doc._id ? String(doc._id) : doc.id

      const confirmed = window.confirm('Delete this gameplay permanently? This cannot be undone.')
      if (!confirmed) return

      await apiDelete(`/api/gameplay/${id}`)
      toast.success('Gameplay deleted')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gameplay</h1>
          <p className="text-muted text-sm mt-1">Active and completed game sessions. Status controls are functional.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', ...statusOptions] as const).map((s) => (
            <button
              key={s}
              onClick={() => setNextStatusFilter(s as any)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (nextStatusFilter === s ? 'bg-white/8 text-text border-accent/30' : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {s === 'all' ? 'ALL' : s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-12 gap-0 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
              <div className="col-span-2">Game</div>
              <div className="col-span-2">Schedule</div>
              <div className="col-span-1">Mode</div>
              <div className="col-span-2">Group</div>
              <div className="col-span-1">Package</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            <div className="divide-y divide-white/5">
              {loading ? (
                <div className="p-6 text-sm text-muted">Loading gameplay…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-muted">No gameplay records.</div>
              ) : (
                filtered.map((doc) => {
                  const st = normalizeStatus(doc.Status)
                  return (
                    <div key={doc._id ? String(doc._id) : doc.reservationId} className="grid grid-cols-12 items-center px-3 py-3">
                      <div className="col-span-2 text-sm font-semibold">{doc.Game || '—'}</div>
                      <div className="col-span-2 text-sm text-muted">{doc.Schedule || doc.createdAtISO || '—'}</div>
                      <div className="col-span-1 text-sm text-muted">{doc.Mode || '—'}</div>
                      <div className="col-span-2 text-sm text-muted">{doc.Group || '—'}</div>
                      <div className="col-span-1 text-sm text-muted">{doc.Package || '—'}</div>
                      <div className="col-span-1">
                        <StatusBadge status={st} />
                      </div>
                      <div className="col-span-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={st}
                            onChange={(e) => updateStatus(doc, e.target.value as GameplayStatus)}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-text"
                            aria-label="Update gameplay status"
                          >
                            {statusOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt.toUpperCase()}
                              </option>
                            ))}
                          </select>

                          {canDelete(st) ? (
                            <button
                              onClick={() => deleteGameplay(doc)}
                              className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/15 transition"
                              title="Delete gameplay"
                            >
                              <FiTrash2 className="inline-block mr-1" /> Delete
                            </button>
                          ) : (
                            <button
                              className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted opacity-60"
                              disabled
                              title="Delete available only when COMPLETED"
                            >
                              <FiTrash2 className="inline-block mr-1" /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

