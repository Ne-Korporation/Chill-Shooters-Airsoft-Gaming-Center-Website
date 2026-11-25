import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiEdit2, FiPlus, FiSearch, FiTrash2, FiUsers, FiX } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import {
  MAX_SAVED_TEAMS, MAX_TEAM_MEMBERS, canBook, createSavedTeam, deleteSavedTeam, findPlayers, listSavedTeams, updateSavedTeam,
  type FoundPlayer, type SavedTeam,
} from '../../utils/savedTeams'

// One teammate on the editor: either from the saved team (with their booking status) or just found.
type DraftMember = { id: string; name: string; email: string; blockedReason: string }

const formatDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }) : '')

// Create or edit a team: its name, then teammates found by name or email (verified players only,
// the same lookup the booking form uses).
function TeamEditor({ team, onClose, onSaved }: { team: SavedTeam | null; onClose: () => void; onSaved: (team: SavedTeam) => void }) {
  const [name, setName] = useState(team?.name || '')
  const [members, setMembers] = useState<DraftMember[]>(() => (team?.members || []).map((m) => ({ id: m.id, name: m.name, email: m.email, blockedReason: m.blockedReason })))
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundPlayer[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)

  const search = async (event?: React.FormEvent) => {
    event?.preventDefault()
    const q = query.trim()
    if (!q) return
    if (!q.includes('@') && q.length < 3) { setSearchError('Type at least 3 letters of the name, or the full email.'); return }
    setSearching(true)
    setSearchError('')
    setFound([])
    try {
      setFound(await findPlayers(q))
    } catch (err: any) {
      setSearchError(err?.message || 'Could not look up that player.')
    } finally {
      setSearching(false)
    }
  }

  const add = (player: FoundPlayer) => {
    if (members.some((m) => m.id === player.id)) return
    if (members.length >= MAX_TEAM_MEMBERS) { setSearchError(`A team can have up to ${MAX_TEAM_MEMBERS} teammates.`); return }
    setMembers((current) => [...current, { id: player.id, name: player.name || player.email, email: player.email, blockedReason: player.waiverApproved ? '' : 'Waiver not approved' }])
    setQuery('')
    setFound([])
  }

  const save = async () => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) { setNameError('Give the team a name.'); return }
    setSaving(true)
    try {
      const memberIds = members.map((m) => m.id)
      const saved = team ? await updateSavedTeam(team.id, { name: clean, memberIds }) : await createSavedTeam(clean, memberIds)
      toast.success(team ? `${saved.name} saved.` : `${saved.name} created.`)
      onSaved(saved)
    } catch (err: any) {
      const message = String(err?.message || 'Could not save the team.')
      if (/name|called/i.test(message)) setNameError(message)
      else toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      eyebrow={team ? 'Edit team' : 'New team'}
      title={name.trim() || (team ? team.name : 'New team')}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1 sm:flex-none" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : team ? 'Save team' : 'Create team'}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input
          label="Team name"
          value={name}
          maxLength={60}
          placeholder="e.g., Bravo Squad"
          error={nameError || undefined}
          onChange={(e) => { setName(e.target.value); setNameError('') }}
        />

        <div>
          <div className="mb-1 text-sm font-semibold">Add teammates</div>
          <p className="mb-2 text-xs text-muted">Find each player by name or by the email on their account. Only players with a verified ID can be added. You don't need to add yourself.</p>
          <form className="flex gap-2" onSubmit={search}>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchError('') }}
              placeholder="Juan Dela Cruz or teammate@gmail.com"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/40"
              aria-label="Teammate name or email"
            />
            <Button type="submit" variant="ghost" disabled={!query.trim() || searching}><FiSearch /> {searching ? 'Finding…' : 'Find'}</Button>
          </form>
          {searchError ? <div className="mt-2 text-xs text-danger">{searchError}</div> : null}
          {found.length ? (
            <ul className="mt-2 space-y-1.5">
              {found.map((player) => {
                const added = members.some((m) => m.id === player.id)
                return (
                  <li key={player.id} className="flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{player.name}</div>
                      <div className="truncate text-xs text-muted">{player.email}{player.waiverApproved ? '' : ' · waiver not approved yet'}</div>
                    </div>
                    <Button size="xs" variant={added ? 'ghost' : 'accent-soft'} disabled={added} onClick={() => add(player)}>
                      {added ? <><FiCheck /> Added</> : <><FiPlus /> Add</>}
                    </Button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.15em] text-muted">
            <span>Teammates</span>
            <span>{members.length} + you</span>
          </div>
          {members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-muted">No teammates yet. Find them above.</div>
          ) : (
            <ul className="space-y-1.5">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{member.name}</div>
                    <div className="truncate text-xs text-muted">
                      {member.email}
                      {member.blockedReason ? <span className="text-warning"> · {member.blockedReason}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMembers((current) => current.filter((m) => m.id !== member.id))}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/10 hover:text-text"
                    aria-label={`Remove ${member.name}`}
                  >
                    <FiX /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

// My Teams: the player's saved rosters, ready to fill a booking's teammates in one step.
export function MyTeamsPage() {
  const [teams, setTeams] = useState<SavedTeam[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<SavedTeam | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      setTeams(await listSavedTeams())
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Could not load your teams.')
      setTeams((current) => current || [])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const remove = async (team: SavedTeam) => {
    const ok = await confirmDialog({
      title: `Delete ${team.name}?`,
      message: 'The team is removed from your saved teams. Bookings already made with it are not affected.',
      confirmLabel: 'Delete team',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteSavedTeam(team.id)
      setTeams((current) => (current || []).filter((t) => t.id !== team.id))
      toast.success(`${team.name} deleted.`)
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete the team.')
    }
  }

  const atLimit = (teams?.length || 0) >= MAX_SAVED_TEAMS

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">My Teams</h1>
          <p className="mt-1 text-sm text-muted">Save the people you usually play with, then fill a booking's teammates in one step.</p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={atLimit} title={atLimit ? `You can save up to ${MAX_SAVED_TEAMS} teams.` : undefined}><FiPlus /> New team</Button>
      </div>

      {error ? <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}

      {teams === null ? (
        <Card className="p-6 text-sm text-muted">Loading your teams…</Card>
      ) : teams.length === 0 ? (
        <Card className="p-6 text-center">
          <FiUsers className="mx-auto text-3xl text-muted" />
          <div className="mt-2 font-semibold">No saved teams yet</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Create a team here, or save one from the booking form after adding your teammates. Next time, pick it and everyone is added at once.</p>
          <Button className="mt-4" onClick={() => setEditing('new')}><FiPlus /> Create a team</Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {teams.map((team) => {
            const ready = team.members.filter(canBook).length
            const blocked = team.members.length - ready
            return (
              <Card key={team.id} className="p-4 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-bold">{team.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {team.members.length + 1} player{team.members.length ? 's' : ''} with you
                      {team.lastUsedAtISO ? ` · last used ${formatDay(team.lastUsedAtISO)}` : ` · saved ${formatDay(team.createdAtISO)}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(team)} aria-label={`Edit ${team.name}`}><FiEdit2 /> Edit</Button>
                    <Button size="xs" variant="danger-soft" onClick={() => void remove(team)} aria-label={`Delete ${team.name}`}><FiTrash2 /></Button>
                  </div>
                </div>

                {blocked > 0 ? (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <FiAlertTriangle className="mt-0.5 shrink-0" />
                    <span>{blocked} teammate{blocked === 1 ? " can't" : "s can't"} be booked right now. They're skipped when you use this team until they're cleared.</span>
                  </div>
                ) : null}

                <ul className="mt-3 space-y-1.5">
                  {team.members.length === 0 ? <li className="text-xs text-muted">No teammates yet.</li> : team.members.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{member.name}</span>
                      {member.blockedReason
                        ? <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">{member.blockedReason}</span>
                        : <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Ready</span>}
                    </li>
                  ))}
                </ul>

                <Link
                  to={`/app/reservations?team=${encodeURIComponent(team.id)}`}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
                >
                  Book with this team →
                </Link>
              </Card>
            )
          })}
        </div>
      )}

      {editing ? (
        <TeamEditor
          team={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setTeams((current) => {
              const rest = (current || []).filter((t) => t.id !== saved.id)
              return [saved, ...rest]
            })
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
