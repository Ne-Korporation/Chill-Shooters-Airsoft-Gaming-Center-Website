import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheckSquare, FiRefreshCw, FiSquare, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { apiGet, apiPut } from '../../utils/apiClient'
import { LOCATIONS, SLOTS, manilaTodayISO, selectClass } from './shared'

type CheckInPlayer = {
  key: string
  id: string
  name: string
  guest: boolean
  experienceLevel: string
  ageGroup: string
  checkedIn: boolean
  checkedInAtISO: string | null
  checkedInBy: string
}

type CheckInTeam = {
  reservationId: string
  label?: string
  reservationStatus?: string
  players: CheckInPlayer[]
}

const REFRESH_MS = 20_000

// Registrars tick off each booked team's players as they arrive; marshals see the same
// list (read-only, refreshed automatically) to know who from each team is on the field.
export function FieldCheckInPage() {
  const { user } = useAuth()
  const canEdit = user?.role === 'registrar' || user?.role === 'admin'
  const [location, setLocation] = useState<string>(LOCATIONS[0].id)
  const [date, setDate] = useState(manilaTodayISO())
  const [slot, setSlot] = useState<string>('morning')
  const [teams, setTeams] = useState<CheckInTeam[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const query = new URLSearchParams({ location, date, slot })
      const res = await apiGet<{ ok: boolean; data: { teams: CheckInTeam[] } }>(`/api/field-checkin?${query}`)
      setTeams(res.data.teams)
    } catch (e: any) {
      if (!quiet) toast.error(e?.message || 'Could not load the check-in list')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [location, date, slot])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const toggle = async (player: CheckInPlayer) => {
    if (!canEdit) return
    setSavingKey(player.key)
    try {
      const res = await apiPut<{ ok: boolean; data: { checkedIn: boolean; atISO: string } }>('/api/field-checkin', {
        location, date, slot, playerKey: player.key, checkedIn: !player.checkedIn,
      })
      setTeams((current) => (current || []).map((team) => ({
        ...team,
        players: team.players.map((p) => (p.key === player.key
          ? { ...p, checkedIn: res.data.checkedIn, checkedInAtISO: res.data.checkedIn ? res.data.atISO : null, checkedInBy: res.data.checkedIn ? user?.email || '' : '' }
          : p)),
      })))
    } catch (e: any) {
      toast.error(e?.message || 'Could not update check-in')
    } finally {
      setSavingKey(null)
    }
  }

  const allPlayers = (teams || []).flatMap((team) => team.players)
  const arrived = allPlayers.filter((p) => p.checkedIn).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Field Check-in</h1>
        <p className="mt-1 text-sm text-muted">
          {canEdit
            ? 'Tick off each player as they arrive. Marshals see this list live to know who from each team is on the field.'
            : 'Who from each team has checked in with the registrar. This list refreshes automatically.'}
        </p>
      </div>

      <Card className="p-4 md:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="flex items-end">
            <Button variant="primary" className="w-full" disabled={loading} onClick={() => load()}>
              <FiRefreshCw /> {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </Card>

      {teams && teams.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No teams are booked for this session.</Card>
      ) : null}

      {teams && teams.length > 0 ? (
        <>
          <div className="text-sm text-muted">
            <span className="font-semibold text-text">{arrived}</span> of {allPlayers.length} players on the field
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((team) => {
              const teamArrived = team.players.filter((p) => p.checkedIn).length
              return (
                <Card key={team.reservationId} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold">{team.label || team.reservationId}</div>
                      <div className="text-[11px] text-muted">Reservation {team.reservationId}</div>
                    </div>
                    <span className={`flex flex-none items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${teamArrived === team.players.length ? 'border-success/30 bg-success/15 text-success' : 'border-white/10 bg-white/5 text-muted'}`}>
                      <FiUsers /> {teamArrived}/{team.players.length}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {team.players.map((player) => (
                      <li key={player.key}>
                        <button
                          type="button"
                          disabled={!canEdit || savingKey === player.key}
                          onClick={() => toggle(player)}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${player.checkedIn ? 'border-success/30 bg-success/10' : 'border-white/10 bg-white/5'} ${canEdit ? 'hover:brightness-110' : 'cursor-default'}`}
                          aria-pressed={player.checkedIn}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{player.name}</div>
                            <div className="text-[11px] text-muted">
                              {player.guest ? 'Guest (no account)' : player.experienceLevel} · {player.ageGroup}
                              {player.checkedInAtISO ? ` · in at ${new Date(player.checkedInAtISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                            </div>
                          </div>
                          {player.checkedIn
                            ? <FiCheckSquare className="flex-none text-lg text-success" aria-label="Checked in" />
                            : <FiSquare className="flex-none text-lg text-muted" aria-label="Not checked in" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
