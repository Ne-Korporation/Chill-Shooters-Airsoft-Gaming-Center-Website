import React, { useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FiCheck, FiClock, FiMapPin, FiShield, FiChevronRight, FiSearch, FiX } from 'react-icons/fi'

type GameStatus = 'scheduled' | 'live' | 'completed'

type GameRow = {
  id: string
  dateISO: string
  fieldName: string
  slotLabel: string
  sessionType: 'Public' | 'Private'
  gameMode: string
  players: number
  packageName: string
  status: GameStatus
}

const slotLabels: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

function makeISO(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function RegistrarOngoingGamesPage() {
  const today = useMemo(() => new Date(), [])

  const [rows, setRows] = useState<GameRow[]>(() => [
    {
      id: 'game-13001',
      dateISO: makeISO(new Date(today.getTime())),
      fieldName: 'Upper Ground',
      slotLabel: slotLabels.evening,
      sessionType: 'Public',
      gameMode: 'Squad Deathmatch',
      players: 16,
      packageName: 'Sentry Core (Small Unit)',
      status: 'live',
    },
    {
      id: 'game-13002',
      dateISO: makeISO(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
      fieldName: 'Lower Ground',
      slotLabel: slotLabels.afternoon,
      sessionType: 'Private',
      gameMode: 'Capture the Flag',
      players: 12,
      packageName: 'Objective Handler (CTF)',
      status: 'scheduled',
    },
    {
      id: 'game-13003',
      dateISO: makeISO(new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)),
      fieldName: 'Forest',
      slotLabel: slotLabels.morning,
      sessionType: 'Public',
      gameMode: 'Search & Destroy',
      players: 10,
      packageName: 'Reconline (S&D Standard)',
      status: 'scheduled',
    },
  ])

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.fieldName.toLowerCase().includes(q) ||
        r.gameMode.toLowerCase().includes(q) ||
        r.packageName.toLowerCase().includes(q)
      )
    })
  }, [query, rows])

  const liveCount = useMemo(() => rows.filter((r) => r.status === 'live').length, [rows])

  const markCompleted = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'completed' } : r)))
  }

  const startGame = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'live' } : r)))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Registrar</span>
        </div>
        <h1 className="text-3xl font-bold">Ongoing Games</h1>
        <p className="text-muted text-sm">View scheduled and live games. Prototype actions simulate status updates.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Live</div>
          <div className="mt-2 text-2xl font-bold text-accent">{liveCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Scheduled</div>
          <div className="mt-2 text-2xl font-bold">{rows.filter((r) => r.status === 'scheduled').length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Completed</div>
          <div className="mt-2 text-2xl font-bold text-success">{rows.filter((r) => r.status === 'completed').length}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Game queue</span>
            </div>
            <div className="mt-1 text-xs text-muted">Use search to filter. Start/complete buttons are frontend-only.</div>
          </div>

          <div className="md:w-[420px]">
            <div className="relative">
              <FiSearch className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search game id, field, mode, package"
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
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.id}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.dateISO}</div>
                    <div className="mt-1 text-xs text-muted flex items-center gap-2">
                      <FiClock /> {r.slotLabel}
                    </div>
                    <div className="mt-1 text-xs text-muted flex items-center gap-2">
                      <FiMapPin /> {r.fieldName}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.gameMode}</div>
                    <div className="mt-1 text-xs text-muted">{r.sessionType} session</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.players} players</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.packageName}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
                        r.status === 'live'
                          ? 'bg-accent/15 text-gold border-accent/30'
                          : r.status === 'scheduled'
                            ? 'bg-white/5 text-muted border-white/10'
                            : 'bg-success/15 text-success border-success/30',
                      ].join(' ')}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {r.status === 'scheduled' ? (
                        <Button variant="primary" className="w-full sm:w-auto" onClick={() => startGame(r.id)}>
                          Start
                          <FiChevronRight />
                        </Button>
                      ) : null}
                      {r.status === 'live' ? (
                        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => markCompleted(r.id)}>
                          Complete
                          <FiChevronRight />
                        </Button>
                      ) : null}
                      {r.status !== 'scheduled' && r.status !== 'live' ? <div className="text-xs text-muted">No action</div> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-muted">
                    No ongoing games match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiShield className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Registrar visibility</div>
              <div className="mt-1 text-xs text-muted">
                In a real system, this list would be driven by approved reservations and marshal check-in events.
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

