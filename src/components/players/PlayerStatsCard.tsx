import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAward } from 'react-icons/fi'

import { Button } from '../ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'

type PlayerStats = {
  gamesPlayed: number
  experienceAdjustment: number
  experience: number
  experienceLevel: string
  age: number | null
  ageGroup: string
  reservations: {
    total: number
    upcoming: number
    cancelled: number
    recent: Array<{ id: string; reservationDate: string; reservationTime: string; reservationStatus: string; locationName?: string; asCaptain: boolean }>
  }
  ownedGear: Array<{ id: string; name: string; kind: 'weapon' | 'equipment'; category?: string }>
}

// Experience (games played at the field + admin adjustment), age group, reservation history, and
// approved gear for one player. Admins can change the adjustment here.
export function PlayerStatsCard({ playerId, canAdjust = false }: { playerId: string; canAdjust?: boolean }) {
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [adjustment, setAdjustment] = useState('0')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    apiGet<{ data: PlayerStats }>(`/api/players/${encodeURIComponent(playerId)}/stats`)
      .then((res) => {
        setStats(res.data)
        setAdjustment(String(res.data.experienceAdjustment || 0))
      })
      .catch(() => setStats(null))
  }, [playerId])

  useEffect(() => {
    load()
  }, [load])

  const saveAdjustment = async () => {
    setSaving(true)
    try {
      await apiPut(`/api/players/${encodeURIComponent(playerId)}/experience`, { adjustment: Number(adjustment), note })
      toast.success('Experience updated.')
      setNote('')
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not update experience')
    } finally {
      setSaving(false)
    }
  }

  if (!stats) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiAward /> Experience & history</div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted">Level</div>
          <div className="text-sm font-bold">{stats.experienceLevel}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Games played</div>
          <div className="text-sm font-bold">
            {stats.gamesPlayed}
            {stats.experienceAdjustment ? <span className="text-xs font-normal text-muted"> {stats.experienceAdjustment > 0 ? '+' : ''}{stats.experienceAdjustment} adj.</span> : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Age group</div>
          <div className="text-sm font-bold">{stats.age ? `${stats.ageGroup} (${stats.age})` : stats.ageGroup}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Reservations</div>
          <div className="text-sm font-bold">{stats.reservations.total} <span className="text-xs font-normal text-muted">({stats.reservations.upcoming} upcoming)</span></div>
        </div>
      </div>

      {stats.reservations.recent.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {stats.reservations.recent.map((r) => (
            <li key={r.id}>
              {r.reservationDate} · <span className="capitalize">{r.reservationTime}</span> · {r.locationName || ''} · <span className="capitalize">{r.reservationStatus}</span>
              {r.asCaptain ? ' · captain' : ' · teammate'}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 text-xs text-muted">
        Registered gear: {stats.ownedGear.length ? stats.ownedGear.map((g) => g.name).join(', ') : 'none approved yet'}
      </div>

      {canAdjust ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-end">
          <label className="block">
            <div className="mb-1 text-xs font-semibold">Experience adjustment</div>
            <input
              type="number"
              value={adjustment}
              onChange={(e) => setAdjustment(e.target.value)}
              className="w-28 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm"
              aria-describedby="experience-adjustment-hint"
            />
          </label>
          <label className="block flex-1">
            <div className="mb-1 text-xs font-semibold">Reason</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Played before the system existed"
              className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm"
            />
          </label>
          <Button size="sm" variant="secondary" disabled={saving} onClick={saveAdjustment}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      ) : null}
      {canAdjust ? (
        <div id="experience-adjustment-hint" className="mt-1 text-[11px] text-muted">
          Added to the games played at the field (use a negative number to reduce). Total experience: {stats.experience}.
        </div>
      ) : null}
    </div>
  )
}
