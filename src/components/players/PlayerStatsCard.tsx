import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAward, FiClock } from 'react-icons/fi'

import { Button } from '../ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'
import { bookingRoles } from '../../utils/bookingRoles'

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
    recent: Array<{ id: string; reservationDate: string; reservationTime: string; reservationStatus: string; locationName?: string; asCaptain: boolean; sessionType?: string; played?: boolean }>
  }
  ownedGear: Array<{ id: string; name: string; kind: 'weapon' | 'equipment'; category?: string }>
}

// Matches the levels the server assigns (server/routes/fieldOps.js).
const LEVELS = [
  { name: 'Beginner', from: 0, to: 10 },
  { name: 'Intermediate', from: 11, to: 25 },
  { name: 'Experienced', from: 26, to: Infinity },
]
// Games played on a bar of three segments, one per level; each segment fills across its own range.
export function ExperienceProgress({ gamesPlayed }: { gamesPlayed: number }) {
  const games = Math.max(0, Math.floor(gamesPlayed || 0))
  const level = LEVELS.find((entry) => games >= entry.from && games <= entry.to) || LEVELS[0]
  const next = LEVELS[LEVELS.indexOf(level) + 1]
  // How full a level's segment is: Beginner spans 0→11 games, Intermediate 11→26, Experienced is full from 26.
  const fill = (entry: typeof LEVELS[number]) => {
    if (!Number.isFinite(entry.to)) return games >= entry.from ? 100 : 0
    const span = entry.to + 1 - entry.from
    return Math.max(0, Math.min(100, ((games - entry.from) / span) * 100))
  }
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-text">{level.name} · {games} game{games === 1 ? '' : 's'}</span>
        <span className="text-muted">
          {next ? `${next.from - games} more game${next.from - games === 1 ? '' : 's'} to ${next.name}` : 'Top level reached'}
        </span>
      </div>
      <div
        className="mt-2 grid grid-cols-3 gap-1"
        role="progressbar"
        aria-label="Experience progress"
        aria-valuemin={0}
        aria-valuemax={26}
        aria-valuenow={Math.min(games, 26)}
        aria-valuetext={`${games} games played, ${level.name}`}
      >
        {LEVELS.map((entry) => (
          <div key={entry.name} className="h-2.5 overflow-hidden rounded-full bg-black/20">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${fill(entry)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted">
        <span>Beginner (0–10)</span>
        <span className="text-center">Intermediate (11–25)</span>
        <span className="text-right">Experienced (26+)</span>
      </div>
    </div>
  )
}

type HistoryItem = PlayerStats['reservations']['recent'][number]

// "2026-11-21" → "Sat, Nov 21, 2026"
function formatHistoryDate(dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateISO
  return date.toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// What happened to a reservation, in the player's words.
function historyOutcome(r: HistoryItem) {
  const status = String(r.reservationStatus || '').toLowerCase()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  if (status === 'cancelled') return { label: 'Cancelled', className: 'bg-white/10 text-muted' }
  if (r.played) return { label: 'Played', className: 'bg-success/15 text-success' }
  if (r.reservationDate >= today) return { label: 'Upcoming', className: 'bg-accent/15 text-accent' }
  return { label: 'Not played', className: 'bg-warning/15 text-warning' }
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
    <div className="space-y-4">
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiAward /> Experience</div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
      </div>

      <ExperienceProgress gamesPlayed={stats.gamesPlayed} />

      <div className="mt-3 text-xs text-muted">
        Registered gear: {stats.ownedGear.length ? stats.ownedGear.map((g) => g.name).join(', ') : 'none added yet'}
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

    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiClock /> History</div>
        <div className="text-xs text-muted">
          <span className="font-bold text-text">{stats.reservations.total}</span> reservation{stats.reservations.total === 1 ? '' : 's'} · {stats.reservations.upcoming} upcoming
        </div>
      </div>
      {stats.reservations.recent.length > 0 ? (
        <>
          <div className="mt-3 text-[11px] text-muted">Your last {stats.reservations.recent.length} reservations</div>
          <ul className="mt-1 divide-y divide-white/5">
            {stats.reservations.recent.map((r) => {
              const outcome = historyOutcome(r)
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      {formatHistoryDate(r.reservationDate)} · <span className="capitalize">{r.reservationTime}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {r.locationName || 'Field'} · {r.asCaptain ? 'You booked' : `Joined as ${bookingRoles(r.sessionType).member.toLowerCase()}`}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${outcome.className}`}>{outcome.label}</span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="mt-3 text-xs text-muted">No reservations yet.</div>
      )}
    </div>
    </div>
  )
}
