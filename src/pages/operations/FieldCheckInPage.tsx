import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiSearch } from 'react-icons/fi'

import { useAuth } from '../../context/AuthContext'
import { apiGet, apiPut } from '../../utils/apiClient'

export type CheckInPlayer = {
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

export type CheckInTeam = {
  reservationId: string
  label?: string
  reservationStatus?: string
  players: CheckInPlayer[]
}

export type CheckInSession = { location: string; date: string; slot: string }

const REFRESH_MS = 20_000

// Every booked team in one session (location + date + slot) with who has arrived.
export async function fetchCheckInTeams(session: CheckInSession) {
  const query = new URLSearchParams(session)
  const res = await apiGet<{ ok: boolean; data: { teams: CheckInTeam[] } }>(`/api/field-checkin?${query}`)
  return res.data.teams
}

// Field check-in for one booking, shown in a game's pop-up on the Games page: registrars and
// marshals tick off each player as they arrive. It refreshes on its own, so everyone sees who
// from the team is on the field.
export function TeamCheckIn({ session, reservationId }: { session: CheckInSession; reservationId: string }) {
  const { user } = useAuth()
  const canEdit = user?.role === 'registrar' || user?.role === 'marshal' || user?.role === 'admin'
  const [team, setTeam] = useState<CheckInTeam | null | undefined>(undefined)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async (quiet = false) => {
    try {
      const teams = await fetchCheckInTeams(session)
      setTeam(teams.find((t) => t.reservationId === reservationId) || null)
    } catch (e: any) {
      if (!quiet) {
        toast.error(e?.message || 'Could not load the check-in list')
        setTeam(null)
      }
    }
  }, [session.location, session.date, session.slot, reservationId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        ...session, playerKey: player.key, checkedIn: !player.checkedIn,
      })
      setTeam((current) => current && {
        ...current,
        players: current.players.map((p) => (p.key === player.key
          ? { ...p, checkedIn: res.data.checkedIn, checkedInAtISO: res.data.checkedIn ? res.data.atISO : null, checkedInBy: res.data.checkedIn ? user?.email || '' : '' }
          : p)),
      })
    } catch (e: any) {
      toast.error(e?.message || 'Could not update check-in')
    } finally {
      setSavingKey(null)
    }
  }

  if (team === undefined) return <div className="text-sm text-muted">Loading check-in…</div>
  if (team === null) {
    return <div className="text-sm text-muted">This booking has no players to check in for its session (it may be cancelled or not yet confirmed).</div>
  }

  const term = search.trim().toLowerCase()
  const shown = team.players.filter((player) => !term || player.name.toLowerCase().includes(term))
  const arrived = team.players.filter((p) => p.checkedIn).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">
          <span className="font-semibold text-text">{arrived}</span> of {team.players.length} checked in
          {canEdit ? ' · tap a player as they arrive' : ''}
        </div>
        <div className="relative w-full sm:w-64">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names…"
            aria-label="Search team members"
            className="w-full rounded-xl border border-white/10 bg-background py-2 pl-9 pr-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.length === 0 ? (
          <li className="py-4 text-center text-sm text-muted sm:col-span-2">No one matches "{search}".</li>
        ) : shown.map((player) => (
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
    </div>
  )
}
