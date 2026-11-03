import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiRefreshCw, FiSave, FiShuffle, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import { LOCATIONS, SLOTS, manilaTodayISO, selectClass } from './shared'

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

type Team = { name: string; playerKeys: string[] }

// A booked team for the chosen session, from the field check-in list.
type BookedTeam = { reservationId: string; label?: string; players: Array<{ checkedIn: boolean }> }

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

// Marshals load the players checked in for a session, get a suggested split balanced on
// experience level and age, adjust it by moving players, and save the final teams together
// with the list of who was present.
export function TeamGroupingPage() {
  const [location, setLocation] = useState<string>(LOCATIONS[0].id)
  const [date, setDate] = useState(manilaTodayISO())
  const [slot, setSlot] = useState<string>('morning')
  const [teamCount, setTeamCount] = useState(2)
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggestion, setSuggestion] = useState<Team[]>([])
  const [booked, setBooked] = useState(0)
  const [bookedTeams, setBookedTeams] = useState<BookedTeam[] | null>(null)

  // The teams booked for the chosen slot show as soon as it is picked, before loading the session.
  useEffect(() => {
    let cancelled = false
    setBookedTeams(null)
    apiGet<{ ok: boolean; data: { teams: BookedTeam[] } }>(`/api/field-checkin?${new URLSearchParams({ location, date, slot })}`)
      .then((res) => { if (!cancelled) setBookedTeams(res.data.teams) })
      .catch(() => { if (!cancelled) setBookedTeams([]) })
    return () => { cancelled = true }
  }, [location, date, slot])

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
      if (res.data.roster.length === 0) {
        toast(res.data.booked > 0
          ? `None of the ${res.data.booked} booked players have checked in yet. Check players in on Field Check-in first.`
          : 'No players are booked for this session yet.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not load the session')
    } finally {
      setLoading(false)
    }
  }, [location, date, slot, teamCount])

  const byKey = useMemo(() => new Map(roster.map((player) => [player.key, player])), [roster])
  const unassigned = useMemo(() => {
    const assigned = new Set(teams.flatMap((team) => team.playerKeys))
    return roster.filter((player) => !assigned.has(player.key))
  }, [roster, teams])

  const movePlayer = (key: string, toIndex: number) => {
    setTeams((current) => current.map((team, index) => ({
      ...team,
      playerKeys: index === toIndex
        ? [...team.playerKeys.filter((k) => k !== key), key]
        : team.playerKeys.filter((k) => k !== key),
    })))
    setSavedAt(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: { savedAtISO: string } }>('/api/team-grouping', { location, date, slot, teams })
      setSavedAt(res.data.savedAtISO)
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Team Grouping</h1>
        <p className="mt-1 text-sm text-muted">
          Only players checked in for the session are grouped. Suggested teams get an even share of each experience level (total games played: Beginner 0–10, Intermediate 11–25, Experienced 26+), then balance total games and age groups. The marshal makes the final call.
        </p>
      </div>

      <Card className="p-4 md:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Location</div>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={selectClass}>
              {LOCATIONS.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Date</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={selectClass} />
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Time slot</div>
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className={`${selectClass} capitalize`}>
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Teams</div>
            <select value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} className={selectClass}>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button variant="primary" className="w-full" disabled={loading} onClick={() => load(false)}>
              <FiRefreshCw /> {loading ? 'Loading…' : 'Load session'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold">Teams booked for this slot</div>
          {bookedTeams && bookedTeams.length > 0 ? (
            <div className="text-xs text-muted">
              {bookedTeams.reduce((n, t) => n + t.players.filter((p) => p.checkedIn).length, 0)} of {bookedTeams.reduce((n, t) => n + t.players.length, 0)} players checked in
            </div>
          ) : null}
        </div>
        {bookedTeams === null ? (
          <div className="mt-2 text-sm text-muted">Loading…</div>
        ) : bookedTeams.length === 0 ? (
          <div className="mt-2 text-sm text-muted">No teams are booked for this location, date, and time slot.</div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {bookedTeams.map((team) => {
              const arrived = team.players.filter((p) => p.checkedIn).length
              return (
                <li key={team.reservationId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
                  <span className="font-semibold">{team.label || team.reservationId}</span>
                  <span className={`text-xs ${arrived === team.players.length ? 'text-success' : 'text-muted'}`}>{arrived}/{team.players.length} in</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {roster.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted">
              {roster.length} of {booked} booked player{booked === 1 ? '' : 's'} present · {savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : 'Not saved yet'}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setTeams(suggestion); setSavedAt(null) }}>
                <FiShuffle /> Use suggestion
              </Button>
              <Button variant="primary" disabled={saving} onClick={save}>
                <FiSave /> {saving ? 'Saving…' : 'Save teams'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((team, teamIndex) => {
              const stats = teamStats(team)
              return (
                <Card key={teamIndex} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={team.name}
                      onChange={(e) => setTeams((current) => current.map((t, i) => (i === teamIndex ? { ...t, name: e.target.value } : t)))}
                      className="w-full bg-transparent text-base font-bold focus:outline-none"
                      aria-label="Team name"
                    />
                    <FiUsers className="flex-none text-gold" />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {stats.players.length} players · {stats.experience} total games played
                    {stats.averageAge ? ` · avg age ${stats.averageAge}` : ''}
                    {stats.minors ? ` · ${stats.minors} under 18` : ''}
                  </div>
                  {stats.levels ? <div className="mt-0.5 text-xs text-muted">{stats.levels}</div> : null}
                  <ul className="mt-3 space-y-2">
                    {stats.players.map((player) => (
                      <li key={player.key} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="min-w-0">
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
                            className="rounded-lg border border-white/10 bg-background px-2 py-1 text-xs [&>option]:bg-background"
                            aria-label={`Move ${player.name}`}
                          >
                            {teams.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            })}
          </div>

          {unassigned.length > 0 ? (
            <Card className="p-4">
              <div className="text-sm font-bold">Not on a team ({unassigned.length})</div>
              <div className="mt-1 text-xs text-muted">Players who checked in after these teams were saved.</div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {unassigned.map((player) => (
                  <li key={player.key} className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                    {player.name}
                    <select
                      value=""
                      onChange={(e) => movePlayer(player.key, Number(e.target.value))}
                      className="rounded-lg border border-white/10 bg-background px-2 py-1 text-xs [&>option]:bg-background"
                      aria-label={`Assign ${player.name}`}
                    >
                      <option value="" disabled>Assign…</option>
                      {teams.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
