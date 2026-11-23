import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FiMenu, FiRefreshCw, FiSave, FiShuffle, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import type { CheckInSession } from './FieldCheckInPage'

type RosterPlayer = {
  key: string
  id: string
  name: string
  gamesPlayed: number
  experience: number
  experienceLevel: string
  age: number | null
  ageGroup: string
  reservationId: string
  guest: boolean
}

type Team = { name: string; color?: TeamColor; playerKeys: string[] }

// Team colors (armbands), in the order new teams get them; same list as the server's TEAM_COLORS.
type TeamColor = 'red' | 'blue' | 'yellow' | 'green' | 'orange' | 'purple'
const TEAM_COLORS: Array<{ id: TeamColor; label: string; hex: string }> = [
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'yellow', label: 'Yellow', hex: '#eab308' },
  { id: 'green', label: 'Green', hex: '#22c55e' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
]
// Teams saved before colors existed get the color for their position.
const colorOf = (team: Team, index: number) =>
  TEAM_COLORS.find((c) => c.id === team.color) || TEAM_COLORS[index % TEAM_COLORS.length]

type GroupingResponse = {
  roster: RosterPlayer[]
  booked: number
  suggestion: Team[]
  saved: { teams: Team[]; savedAtISO: string } | null
}

const levelClass: Record<string, string> = {
  Experienced: 'border-success/30 bg-success/15 text-success',
  Intermediate: 'border-accent/30 bg-accent/15 text-accent',
  Beginner: 'border-white/10 bg-white/5 text-muted',
}

const smallSelect = 'rounded-lg border border-white/10 bg-background px-2 py-1 text-xs [&>option]:bg-background'

// Teams for one session (location + date + slot), shown in a game's pop-up on the Games page.
// Every booking in the session is grouped together, using only the players checked in. With no
// saved teams the balanced suggestion shows straight away; the marshal adjusts it by moving
// players and saves the final teams together with the list of who was present.
// `active`: the tab is showing. Each time it opens the session is read again, so players just
// checked in are picked up, unless the marshal has unsaved changes.
export function SessionTeams({ session, active }: { session: CheckInSession; active: boolean }) {
  const { location, date, slot } = session
  const [teamCount, setTeamCount] = useState(2)
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggestion, setSuggestion] = useState<Team[]>([])
  const [booked, setBooked] = useState(0)

  const load = useCallback(async (useSuggestion = false) => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ location, date, slot, teams: String(teamCount) })
      const res = await apiGet<{ ok: boolean; data: GroupingResponse }>(`/api/team-grouping?${query}`)
      setRoster(res.data.roster)
      setBooked(res.data.booked)
      setSuggestion(res.data.suggestion)
      const useSaved = !useSuggestion && res.data.saved && res.data.saved.teams.length > 0
      // Players taken off the check-in list since the teams were saved drop out of their team.
      const present = new Set(res.data.roster.map((player) => player.key))
      setTeams(useSaved
        ? res.data.saved!.teams.map((team) => ({ ...team, playerKeys: team.playerKeys.filter((key) => present.has(key)) }))
        : res.data.suggestion)
      setSavedAt(useSaved ? res.data.saved!.savedAtISO : null)
      setDirty(false)
    } catch (e: any) {
      toast.error(e?.message || 'Could not load the teams')
      setRoster((current) => current || [])
    } finally {
      setLoading(false)
    }
  }, [location, date, slot, teamCount])

  // Read the session each time the tab opens, unless there are unsaved changes.
  const latest = useRef({ dirty, load })
  latest.current = { dirty, load }
  useEffect(() => {
    if (active && !latest.current.dirty) void latest.current.load(false)
  }, [active])

  // A different number of teams asks for a fresh suggestion.
  const firstCount = useRef(true)
  useEffect(() => {
    if (firstCount.current) { firstCount.current = false; return }
    void load(true)
  }, [teamCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = useMemo(() => new Map((roster || []).map((player) => [player.key, player])), [roster])
  const unassigned = useMemo(() => {
    const assigned = new Set(teams.flatMap((team) => team.playerKeys))
    return (roster || []).filter((player) => !assigned.has(player.key))
  }, [roster, teams])

  const movePlayer = (key: string, toIndex: number) => {
    setTeams((current) => current.map((team, index) => ({
      ...team,
      playerKeys: index === toIndex
        ? [...team.playerKeys.filter((k) => k !== key), key]
        : team.playerKeys.filter((k) => k !== key),
    })))
    setSavedAt(null)
    setDirty(true)
  }

  // Picking a color another team has swaps the two, so every team keeps its own color.
  const setTeamColor = (teamIndex: number, color: TeamColor) => {
    setTeams((current) => {
      const mine = colorOf(current[teamIndex], teamIndex).id
      return current.map((team, index) => {
        if (index === teamIndex) return { ...team, color }
        return colorOf(team, index).id === color ? { ...team, color: mine } : { ...team, color: colorOf(team, index).id }
      })
    })
    setSavedAt(null)
    setDirty(true)
  }

  // Drag a player onto a team to move them (mouse). The Team dropdown on each player does the
  // same for touch screens and keyboards, which can't drag.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overTeam, setOverTeam] = useState<number | null>(null)
  const dragProps = (key: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData('text/plain', key)
      event.dataTransfer.effectAllowed = 'move'
      setDragKey(key)
    },
    onDragEnd: () => { setDragKey(null); setOverTeam(null) },
  })
  const dropProps = (teamIndex: number) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragKey) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (overTeam !== teamIndex) setOverTeam(teamIndex)
    },
    onDragLeave: (event: React.DragEvent) => {
      // Only when leaving the team card itself, not when moving over a player inside it.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverTeam((current) => (current === teamIndex ? null : current))
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      const key = event.dataTransfer.getData('text/plain') || dragKey
      if (key && !teams[teamIndex]?.playerKeys.includes(key)) movePlayer(key, teamIndex)
      setDragKey(null)
      setOverTeam(null)
    },
  })

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: { savedAtISO: string } }>('/api/team-grouping', { location, date, slot, teams })
      setSavedAt(res.data.savedAtISO)
      setDirty(false)
      toast.success('Teams saved.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not save teams')
    } finally {
      setSaving(false)
    }
  }

  const teamStats = (team: Team) => {
    const players = team.playerKeys.map((key) => byKey.get(key)).filter(Boolean) as RosterPlayer[]
    const ages = players.map((p) => p.age).filter((age): age is number => typeof age === 'number')
    return {
      players,
      experience: players.reduce((sum, p) => sum + p.experience, 0),
      averageAge: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
      minors: players.filter((p) => p.ageGroup === 'Under 18').length,
      levels: ['Experienced', 'Intermediate', 'Beginner']
        .map((level) => [level, players.filter((p) => p.experienceLevel === level).length] as const)
        .filter(([, n]) => n > 0)
        .map(([level, n]) => `${n} ${level.toLowerCase()}`)
        .join(', '),
    }
  }

  if (roster === null) return <div className="text-sm text-muted">Loading teams…</div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Groups every checked-in player in this session (<span className="capitalize">{slot}</span>, {date}), across all its bookings. Suggested teams get an even share of each experience level (total games played: Beginner 0–10, Intermediate 11–25, Experienced 26+), then balance total games and age groups. The marshal makes the final call.
      </p>

      {roster.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-muted">
          {booked > 0
            ? `None of the ${booked} booked players have checked in yet. Check players in on the Check-in tab first.`
            : 'No players are booked for this session yet.'}
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => load(false)}><FiRefreshCw /> Reload</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted">
              {roster.length} of {booked} booked player{booked === 1 ? '' : 's'} checked in ·{' '}
              {savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : dirty ? 'Unsaved changes' : 'Suggested, not saved yet'}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={teamCount}
                onChange={(e) => setTeamCount(Number(e.target.value))}
                className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm [&>option]:bg-background"
                aria-label="Number of teams"
              >
                {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}
              </select>
              <Button variant="ghost" disabled={loading} onClick={() => load(false)} aria-label="Reload"><FiRefreshCw /></Button>
              <Button variant="ghost" onClick={() => { setTeams(suggestion); setSavedAt(null); setDirty(true) }}>
                <FiShuffle /> Use suggestion
              </Button>
              <Button variant="primary" disabled={saving} onClick={save}>
                <FiSave /> {saving ? 'Saving…' : 'Save teams'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {teams.map((team, teamIndex) => {
              const stats = teamStats(team)
              const isTarget = overTeam === teamIndex && dragKey !== null && !team.playerKeys.includes(dragKey)
              const color = colorOf(team, teamIndex)
              return (
                <div
                  key={teamIndex}
                  {...dropProps(teamIndex)}
                  // The team's color runs down its left edge, and fills the outline while a player is dragged over it.
                  className="rounded-2xl border-l-4 transition"
                  style={{
                    borderLeftColor: color.hex,
                    boxShadow: isTarget ? `0 0 0 2px ${color.hex}` : undefined,
                    backgroundColor: isTarget ? `${color.hex}1a` : undefined,
                  }}
                >
                <Card className="h-full rounded-l-none p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: color.hex }} aria-hidden />
                    <input
                      value={team.name}
                      onChange={(e) => {
                        setTeams((current) => current.map((t, i) => (i === teamIndex ? { ...t, name: e.target.value } : t)))
                        setDirty(true)
                      }}
                      className="w-full bg-transparent text-base font-bold focus:outline-none"
                      aria-label="Team name"
                    />
                    <FiUsers className="flex-none" style={{ color: color.hex }} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={`${team.name} color`}>
                    {TEAM_COLORS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={option.id === color.id}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => setTeamColor(teamIndex, option.id)}
                        className={`h-5 w-5 rounded-full transition ${option.id === color.id ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-background' : 'opacity-50 hover:opacity-100'}`}
                        style={{ backgroundColor: option.hex }}
                      />
                    ))}
                    <span className="ml-1 text-xs font-semibold" style={{ color: color.hex }}>{color.label}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {stats.players.length} players · {stats.experience} total games played
                    {stats.averageAge ? ` · avg age ${stats.averageAge}` : ''}
                    {stats.minors ? ` · ${stats.minors} under 18` : ''}
                  </div>
                  {stats.levels ? <div className="mt-0.5 text-xs text-muted">{stats.levels}</div> : null}
                  <ul className="mt-3 min-h-[3rem] space-y-2">
                    {stats.players.length === 0 ? (
                      <li
                        className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-xs text-muted"
                        style={isTarget ? { borderColor: color.hex, color: color.hex } : undefined}
                      >
                        Drag players here
                      </li>
                    ) : null}
                    {stats.players.map((player) => (
                      <li
                        key={player.key}
                        {...dragProps(player.key)}
                        title="Drag to another team"
                        className={`flex cursor-grab items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 active:cursor-grabbing ${dragKey === player.key ? 'opacity-40' : ''}`}
                      >
                        <FiMenu className="h-4 w-4 flex-none text-muted" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{player.name}</div>
                          <div className="text-[11px] text-muted">
                            {player.guest ? 'Guest (no account)' : `${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'} played`}
                            {' · '}{player.ageGroup}
                          </div>
                        </div>
                        <div className="flex flex-none items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${levelClass[player.experienceLevel] || levelClass.Beginner}`}>
                            {player.experienceLevel}
                          </span>
                          <select
                            value={teamIndex}
                            onChange={(e) => movePlayer(player.key, Number(e.target.value))}
                            className={smallSelect}
                            aria-label={`Move ${player.name}`}
                          >
                            {teams.map((t, i) => <option key={i} value={i}>{t.name} ({colorOf(t, i).label})</option>)}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
                </div>
              )
            })}
          </div>

          {unassigned.length > 0 ? (
            <Card className="p-4">
              <div className="text-sm font-bold">Not on a team ({unassigned.length})</div>
              <div className="mt-1 text-xs text-muted">Players who checked in after these teams were saved. Drag them onto a team.</div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {unassigned.map((player) => (
                  <li
                    key={player.key}
                    {...dragProps(player.key)}
                    title="Drag onto a team"
                    className={`flex cursor-grab items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm active:cursor-grabbing ${dragKey === player.key ? 'opacity-40' : ''}`}
                  >
                    <FiMenu className="h-4 w-4 flex-none text-muted" aria-hidden />
                    {player.name}
                    <select
                      value=""
                      onChange={(e) => movePlayer(player.key, Number(e.target.value))}
                      className={smallSelect}
                      aria-label={`Assign ${player.name}`}
                    >
                      <option value="" disabled>Assign…</option>
                      {teams.map((t, i) => <option key={i} value={i}>{t.name} ({colorOf(t, i).label})</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}
