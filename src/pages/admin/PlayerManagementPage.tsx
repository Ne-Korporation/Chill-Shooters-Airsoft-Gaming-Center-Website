import React from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

export function PlayerManagementPage() {
  const [players, setPlayers] = React.useState([
    { name: 'John Alvarez', level: 'Intermediate', status: 'Active', waiver: 'Signed', lastSeen: 'Today • 10:42 AM' },
    { name: 'Mika Santos', level: 'Beginner', status: 'Needs review', waiver: 'Pending', lastSeen: 'Yesterday • 7:15 PM' },
    { name: 'Rafael Cruz', level: 'Advanced', status: 'Active', waiver: 'Signed', lastSeen: 'Today • 8:00 AM' },
  ])

  const [isAdding, setIsAdding] = React.useState(false)
  const [playerForm, setPlayerForm] = React.useState({ name: '', level: 'Beginner', status: 'Active', waiver: 'Pending' })
  const [playerErrors, setPlayerErrors] = React.useState<{ name?: string }>( {})

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Player Management</h1>
        <p className="mt-1 text-sm text-muted">Review player activity, waiver status, and account readiness from one place.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Active players</div>
          <div className="mt-2 text-2xl font-bold text-accent">74</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Waivers pending</div>
          <div className="mt-2 text-2xl font-bold text-danger">4</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">New signups</div>
          <div className="mt-2 text-2xl font-bold text-success">9</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Player roster</div>
            <div className="mt-2 text-sm text-muted">Monitor activity, access level, and waiver completion.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsAdding((s) => !s)}>{isAdding ? 'Close' : 'Add Player'}</Button>
            <Button variant="ghost" size="sm">Export player list</Button>
          </div>
        </div>
        {isAdding ? (
          <div className="mt-3 rounded-2xl border border-white/5 bg-white/5 p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                placeholder="Full name"
                value={playerForm.name}
                onChange={(e) => setPlayerForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text"
              />
              <select
                value={playerForm.level}
                onChange={(e) => setPlayerForm((p) => ({ ...p, level: e.target.value }))}
                className="w-full rounded-xl border border-white/10 glass px-3 py-2 text-sm text-text"
              >
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
              <div className="flex gap-2">
                <Button onClick={() => {
                  const errs: typeof playerErrors = {}
                  if (!playerForm.name.trim()) errs.name = 'Name is required.'
                  if (Object.keys(errs).length) return setPlayerErrors(errs)
                  setPlayers((prev) => [{ ...playerForm, lastSeen: 'Just now' }, ...prev])
                  setPlayerForm({ name: '', level: 'Beginner', status: 'Active', waiver: 'Pending' })
                  setPlayerErrors({})
                  setIsAdding(false)
                }}>Create</Button>
                <Button variant="ghost" onClick={() => { setIsAdding(false); setPlayerErrors({}); setPlayerForm({ name: '', level: 'Beginner', status: 'Active', waiver: 'Pending' }) }}>Cancel</Button>
              </div>
            </div>
            {playerErrors.name ? <div className="mt-2 text-xs text-danger">{playerErrors.name}</div> : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {players.map((player) => (
            <div key={player.name} className="rounded-2xl border border-white/5 bg-white/5 px-4 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold">{player.name}</div>
                  <div className="mt-1 text-xs text-muted">{player.level} • {player.lastSeen}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-accent/30 bg-accent/20 px-3 py-1 text-[11px] font-semibold text-accent">{player.status}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-text">Waiver: {player.waiver}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

