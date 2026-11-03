import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiRefreshCw, FiSearch, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
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

// Registrars and marshals tick off each booked team's players as they arrive; the list
// refreshes automatically so everyone sees who from each team is on the field.
export function FieldCheckInPage() {
  const { user } = useAuth()
  const canEdit = user?.role === 'registrar' || user?.role === 'marshal' || user?.role === 'admin'
  const [location, setLocation] = useState<string>(LOCATIONS[0].id)
  const [date, setDate] = useState(manilaTodayISO())
  const [slot, setSlot] = useState<string>('morning')
  const [teams, setTeams] = useState<CheckInTeam[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [openTeamId, setOpenTeamId] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState('')

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
  // Read from the live list so the pop-up updates as players are ticked and on each refresh.
  const openTeam = (teams || []).find((team) => team.reservationId === openTeamId) || null
  const searchTerm = memberSearch.trim().toLowerCase()
  const shownMembers = (openTeam?.players || []).filter((player) => !searchTerm || player.name.toLowerCase().includes(searchTerm))

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
          {/* Each team is a button; its players open in a pop-up so long rosters don't crowd the page. */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {teams.map((team) => {
              const teamArrived = team.players.filter((p) => p.checkedIn).length
              const complete = teamArrived === team.players.length
              return (
                <button
                  key={team.reservationId}
                  type="button"
                  onClick={() => { setOpenTeamId(team.reservationId); setMemberSearch('') }}
                  className={`surface hover-row flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left transition ${complete ? 'border-success/30' : 'border-white/10'}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{team.label || team.reservationId}</div>
                    <div className="truncate text-[11px] text-muted">Reservation {team.reservationId}</div>
                  </div>
                  <span className={`flex flex-none items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${complete ? 'border-success/30 bg-success/15 text-success' : 'border-white/10 bg-white/5 text-muted'}`}>
                    <FiUsers /> {teamArrived}/{team.players.length}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      {openTeam ? (
        <Modal
          eyebrow={`Reservation ${openTeam.reservationId}`}
          title={openTeam.label || openTeam.reservationId}
          onClose={() => setOpenTeamId(null)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted">
              <span className="font-semibold text-text">{openTeam.players.filter((p) => p.checkedIn).length}</span> of {openTeam.players.length} checked in
            </div>
            <div className="relative w-full sm:w-64">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search names…"
                aria-label="Search team members"
                className="w-full rounded-xl border border-white/10 bg-background py-2 pl-9 pr-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {shownMembers.length === 0 ? (
              <li className="py-4 text-center text-sm text-muted">No one matches "{memberSearch}".</li>
            ) : shownMembers.map((player) => (
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
                  <span
                    className={`grid h-6 w-6 flex-none place-items-center rounded-md border-2 transition ${player.checkedIn ? 'border-success bg-success text-white' : 'border-white/20'}`}
                    aria-label={player.checkedIn ? 'Checked in' : 'Not checked in'}
                  >
                    {player.checkedIn ? <FiCheck className="text-sm" strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  )
}
