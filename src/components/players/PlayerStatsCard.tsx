import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAward } from 'react-icons/fi'

import { Button } from '../ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'

type PlayerStats = {
  gamesPlayed: number
  gamesAtField: number
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

// Experience (total games played: games at the field plus games from before the system), age group,
// reservation history, and approved gear for one player. Admins can correct the total here.
export function PlayerStatsCard({ playerId, canAdjust = false }: { playerId: string; canAdjust?: boolean }) {
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [gamesInput, setGamesInput] = useState('0')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    apiGet<{ data: PlayerStats }>(`/api/players/${encodeURIComponent(playerId)}/stats`)
      .then((res) => {
        setStats(res.data)
        setGamesInput(String(res.data.gamesPlayed || 0))
      })
      .catch(() => setStats(null))
  }, [playerId])

  useEffect(() => {
    load()
  }, [load])

  const saveGames = async () => {
    setSaving(true)
    try {
      await apiPut(`/api/players/${encodeURIComponent(playerId)}/experience`, { gamesPlayed: Number(gamesInput), note })
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
          <div className="text-sm font-bold">{stats.gamesPlayed}</div>
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
            <div className="mb-1 text-xs font-semibold">Total games played</div>
            <input
              type="number"
              min={stats.gamesAtField}
              value={gamesInput}
              onChange={(e) => setGamesInput(e.target.value)}
              className="w-28 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm"
              aria-describedby="experience-adjustment-hint"
            />
          </label>
          <label className="block flex-1">
            <div className="mb-1 text-xs font-semibold">Reason</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Games played before the system existed"
              className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm"
            />
          </label>
          <Button size="sm" variant="secondary" disabled={saving} onClick={saveGames}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      ) : null}
      {canAdjust ? (
        <div id="experience-adjustment-hint" className="mt-1 text-[11px] text-muted">
          The player's total games, which replaces the number shown above. {stats.gamesAtField} of them were completed at the field and can't be removed; games played from now on are added automatically. Beginner 0–10, Intermediate 11–25, Experienced 26+.
        </div>
      ) : null}
    </div>
  )
}
