import React from 'react'
import toast from 'react-hot-toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'

export function PlayerManagementPage() {
  const [activeView, setActiveView] = React.useState<'players' | 'staff'>('players')
  const [players, setPlayers] = React.useState<any[]>([])
  const [staffUsers, setStaffUsers] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [showAddForm, setShowAddForm] = React.useState(false)
  const [newPlayerName, setNewPlayerName] = React.useState('')
  const [newPlayerEmail, setNewPlayerEmail] = React.useState('')
  const [newPlayerLevel, setNewPlayerLevel] = React.useState<'Beginner' | 'Experienced'>('Beginner')
  const [addingPlayer, setAddingPlayer] = React.useState(false)

  const [showAddStaffForm, setShowAddStaffForm] = React.useState(false)
  const [newStaffName, setNewStaffName] = React.useState('')
  const [newStaffEmail, setNewStaffEmail] = React.useState('')
  const [newStaffRole, setNewStaffRole] = React.useState('Marshal')
  const [addingStaff, setAddingStaff] = React.useState(false)

  const [resettingId, setResettingId] = React.useState<string | null>(null)

  const [playerSearch, setPlayerSearch] = React.useState('')
  const [playerLevelFilter, setPlayerLevelFilter] = React.useState<'all' | 'Beginner' | 'Experienced'>('all')
  const [playerVerificationFilter, setPlayerVerificationFilter] = React.useState<'all' | 'verified' | 'pending_review' | 'not_submitted' | 'rejected'>('all')
  const [staffSearch, setStaffSearch] = React.useState('')
  const [staffFilter, setStaffFilter] = React.useState<'all' | 'Marshal' | 'Admin' | 'Registrar'>('all')
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null)
  const [selectedPlayer, setSelectedPlayer] = React.useState<any | null>(null)

  const fetchUsers = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []
      const normalizedPlayers = docs
        .filter((doc: any) => String(doc.role || 'user').toLowerCase() === 'user')
        .map((doc: any) => {
          const role = 'user'
          const emailVerified = doc.emailVerified === true
          const status = emailVerified ? 'Active' : 'Needs review'
          const verificationStatus = String(doc.identityVerificationStatus || 'not_submitted')
          return {
            id: doc.id ?? (doc._id ? String(doc._id) : undefined),
            name: doc.name || doc.fullName || 'Unnamed account',
            email: doc.email || 'No email',
            level: doc.experience || 'Beginner',
            status,
            verificationStatus,
            verificationLabel: verificationStatus === 'verified' ? 'Verified' : verificationStatus === 'pending_review' ? 'Pending review' : 'Not submitted',
            identityDocumentUrl: doc.identityDocumentUrl || null,
            role,
          }
        })
      const normalizedStaff = docs
        .filter((doc: any) => ['admin', 'marshal', 'registrar'].includes(String(doc.role || '').toLowerCase()))
        .map((doc: any) => {
          const role = String(doc.role || '').toLowerCase()
          const label = role.charAt(0).toUpperCase() + role.slice(1)
          return {
            id: doc.id ?? (doc._id ? String(doc._id) : undefined),
            name: doc.name || doc.fullName || 'Unnamed staff',
            role: label, email: doc.email || 'No email',
            badge: role === 'admin' ? 'Full access' : role === 'marshal' ? 'Operations' : 'Reservations',
          }
        })
      setPlayers(normalizedPlayers)
      setStaffUsers(normalizedStaff)
    } catch (e: any) {
      setError(String(e?.message || e))
      setPlayers([])
      setStaffUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleAddPlayer = async () => {
    const trimmedName = newPlayerName.trim()
    const trimmedEmail = newPlayerEmail.trim()
    if (!trimmedName) { toast.error('Player name is required'); return }
    if (!trimmedEmail) { toast.error('Player email is required'); return }
    setAddingPlayer(true)
    try {
      const res = await apiPost<any>('/api/auth/admin/add-player', { name: trimmedName, email: trimmedEmail, skillLevel: newPlayerLevel })
      toast.success(`Player created! Password sent to ${trimmedEmail}`)
      if (res?.data?.defaultPassword) {
        toast((t: any) => (
          <div>
            <p className="font-semibold">Default Password:</p>
            <p className="mt-1 text-lg font-mono bg-white/10 px-2 py-1 rounded">{res.data.defaultPassword}</p>
            <p className="mt-1 text-xs text-muted">(Also sent via email)</p>
          </div>
        ), { duration: 10000 })
      }
      setNewPlayerName(''); setNewPlayerEmail(''); setNewPlayerLevel('Beginner'); setShowAddForm(false)
      await fetchUsers()
    } catch (e: any) { toast.error(String(e?.message || e)) }
    finally { setAddingPlayer(false) }
  }

  const handleAddStaff = async () => {
    const trimmedName = newStaffName.trim()
    const trimmedEmail = newStaffEmail.trim()
    if (!trimmedName) { toast.error('Staff name is required'); return }
    if (!trimmedEmail) { toast.error('Staff email is required'); return }
    setAddingStaff(true)
    try {
      const res = await apiPost<any>('/api/auth/admin/add-staff', { name: trimmedName, email: trimmedEmail, role: newStaffRole.toLowerCase() })
      toast.success(`${newStaffRole} account created!`)
      if (res?.data?.defaultPassword) {
        toast((t: any) => (
          <div>
            <p className="font-semibold">Default Password for {trimmedName}:</p>
            <p className="mt-1 text-lg font-mono bg-white/10 px-2 py-1 rounded">{res.data.defaultPassword}</p>
            <p className="mt-1 text-xs text-muted">(Also sent via email)</p>
          </div>
        ), { duration: 15000 })
      }
      setNewStaffName(''); setNewStaffEmail(''); setNewStaffRole('Marshal'); setShowAddStaffForm(false)
      await fetchUsers()
    } catch (e: any) { toast.error(String(e?.message || e)) }
    finally { setAddingStaff(false) }
  }

  const handleResetPassword = async (staffId: string) => {
    setResettingId(staffId)
    try {
      const res = await apiPost<any>('/api/auth/admin/reset-password', { userId: staffId })
      if (res?.defaultPassword) {
        toast((t: any) => (
          <div>
            <p className="font-semibold">Password Reset Successful!</p>
            <p className="mt-1 text-lg font-mono bg-white/10 px-2 py-1 rounded">{res.defaultPassword}</p>
            <p className="mt-1 text-xs text-muted">(Also sent via email)</p>
            <button onClick={() => toast.dismiss(t.id)} className="mt-2 text-xs text-accent underline">Dismiss</button>
          </div>
        ), { duration: 0 })
      }
    } catch (e: any) { toast.error(String(e?.message || e)) }
    finally { setResettingId(null) }
  }

  const handleSetPlayerVerification = async (playerId: string, status: 'verified' | 'pending_review' | 'rejected') => {
    setVerifyingId(playerId)
    try {
      await apiPut<any>(`/api/user_accounts/${encodeURIComponent(playerId)}`, { identityVerificationStatus: status })
      await fetchUsers()
      setSelectedPlayer((current: any) => current && current.id === playerId ? {
        ...current,
        verificationStatus: status,
        verificationLabel: status === 'verified'
          ? 'Verified'
          : status === 'pending_review'
            ? 'Pending review'
            : 'Rejected',
      } : current)
      toast.success(status === 'verified'
        ? 'Player identity verified'
        : status === 'pending_review'
          ? 'Player marked pending review'
          : 'Player identity rejected')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setVerifyingId(null)
    }
  }

  const handleVerifyPlayer = async (playerId: string) => {
    await handleSetPlayerVerification(playerId, 'verified')
  }

  const handleRejectPlayer = async (playerId: string) => {
    await handleSetPlayerVerification(playerId, 'rejected')
  }

  const playerList = loading ? (
    <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-muted">Loading accounts...</div>
  ) : error ? (
    <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
  ) : (
    players.filter((pl) => {
      const ms = String(pl.name || '').toLowerCase().includes(playerSearch.toLowerCase())
      const lm = playerLevelFilter === 'all' || pl.level === playerLevelFilter
      const vm = playerVerificationFilter === 'all' || pl.verificationStatus === playerVerificationFilter
      return ms && lm && vm
    }).map((pl, idx) => (
      <div key={pl.id || `player-${idx}`} className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">{pl.name}</div>
          <div className="mt-1 text-xs text-muted">{pl.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent/30 bg-accent/20 px-3 py-1 text-[11px] font-semibold text-accent">{pl.status}</span>
            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${pl.verificationStatus === 'verified' ? 'border-success/30 bg-success/20 text-success' : pl.verificationStatus === 'pending_review' ? 'border-accent/30 bg-accent/20 text-accent' : 'border-white/10 bg-white/5 text-muted'}`}>
              {pl.verificationLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pl.identityDocumentUrl && pl.verificationStatus === 'pending_review' ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => pl.id && handleVerifyPlayer(pl.id)} disabled={verifyingId === pl.id}>
                {verifyingId === pl.id ? 'Verifying…' : 'Verify ID'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => pl.id && handleRejectPlayer(pl.id)} disabled={verifyingId === pl.id}>
                {verifyingId === pl.id ? 'Rejecting…' : 'Reject ID'}
              </Button>
            </>
          ) : pl.identityDocumentUrl && pl.verificationStatus === 'rejected' ? (
            <Button variant="ghost" size="sm" onClick={() => pl.id && handleSetPlayerVerification(pl.id, 'pending_review')} disabled={verifyingId === pl.id}>
              {verifyingId === pl.id ? 'Updating…' : 'Reopen review'}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setSelectedPlayer(pl)}>View</Button>
        </div>
      </div>
    ))
  )

  const staffList = loading ? (
    <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-muted">Loading staff accounts...</div>
  ) : error ? (
    <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
  ) : (
    staffUsers.filter((u) => {
      const ms = String(u.role || '').toLowerCase().includes(staffSearch.toLowerCase()) || String(u.email || '').toLowerCase().includes(staffSearch.toLowerCase())
      const mf = staffFilter === 'all' || u.role === staffFilter
      return ms && mf
    }).map((u, idx) => (
      <div key={u.id || `staff-${idx}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{u.role} &mdash; {u.name}</div>
          <div className="mt-1 text-xs text-muted">{u.email}</div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-text">{u.badge}</span>
            <Button variant="ghost" size="sm" onClick={() => u.id && handleResetPassword(u.id)} disabled={resettingId === u.id}>
              {resettingId === u.id ? 'Resetting...' : 'Reset Password'}
            </Button>
          </div>
        </div>
      </div>
    ))
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="mt-1 text-sm text-muted">Manage players and staff accounts, including marshal, admin, and registrar access.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Players</div>
          <div className="mt-2 text-2xl font-bold text-accent">{players.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Staff roles</div>
          <div className="mt-2 text-2xl font-bold text-danger">{staffUsers.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Access ready</div>
          <div className="mt-2 text-2xl font-bold text-success">{staffUsers.length + players.filter((p) => p.status === 'Active').length}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setActiveView('players')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${activeView === 'players' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Players</button>
        <button type="button" onClick={() => setActiveView('staff')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${activeView === 'staff' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Staff</button>
      </div>

      <Card className="p-4">
        {activeView === 'players' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Players</div>
                <div className="mt-2 text-sm text-muted">Review current players and their account status.</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowAddForm((p) => !p)}>
                {showAddForm ? 'Cancel' : 'Add Player'}
              </Button>
            </div>

            {showAddForm && (
              <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Full Name</label>
                    <input 
                      value={newPlayerName} 
                      onChange={(e) => setNewPlayerName(e.target.value)} 
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Email Address</label>
                    <input 
                      value={newPlayerEmail} 
                      onChange={(e) => setNewPlayerEmail(e.target.value)} 
                      type="email" 
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Skill Level</label>
                    <select value={newPlayerLevel} onChange={(e) => setNewPlayerLevel(e.target.value as any)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text">
                      <option>Beginner</option>
                      <option>Experienced</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button onClick={handleAddPlayer} disabled={addingPlayer} className="w-full">
                      {addingPlayer ? 'Creating...' : 'Create Player'}
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowAddForm(false); setNewPlayerName(''); setNewPlayerEmail(''); setNewPlayerLevel('Beginner') }} className="w-full">
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr] md:items-end">
              <div className="w-full md:max-w-xs">
                <label className="block text-xs font-semibold text-muted mb-1">Search Players</label>
                <input 
                  value={playerSearch} 
                  onChange={(e) => setPlayerSearch(e.target.value)} 
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                  placeholder="Search by name or email"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Filter by Level</label>
                  <select value={playerLevelFilter} onChange={(e) => setPlayerLevelFilter(e.target.value as any)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text">
                    <option value="all">All Levels</option>
                    <option value="Beginner">Beginner</option>
                    <option value="Experienced">Experienced</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Filter by Verification</label>
                  <select value={playerVerificationFilter} onChange={(e) => setPlayerVerificationFilter(e.target.value as any)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text">
                    <option value="all">All verification statuses</option>
                    <option value="verified">Verified</option>
                    <option value="pending_review">Pending review</option>
                    <option value="rejected">Rejected</option>
                    <option value="not_submitted">Not submitted</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">{playerList}</div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Staff users</div>
                <div className="mt-2 text-sm text-muted">Assign or review role-based access for staff accounts.</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowAddStaffForm((p) => !p)}>
                {showAddStaffForm ? 'Cancel' : 'Add Staff'}
              </Button>
            </div>

            {showAddStaffForm && (
              <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Full Name</label>
                    <input 
                      value={newStaffName} 
                      onChange={(e) => setNewStaffName(e.target.value)} 
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Email Address</label>
                    <input 
                      value={newStaffEmail} 
                      onChange={(e) => setNewStaffEmail(e.target.value)} 
                      type="email" 
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Role</label>
                    <select value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text">
                      <option>Marshal</option>
                      <option>Admin</option>
                      <option>Registrar</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button onClick={handleAddStaff} disabled={addingStaff} className="w-full">
                      {addingStaff ? 'Creating...' : 'Create Staff'}
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowAddStaffForm(false); setNewStaffName(''); setNewStaffEmail(''); setNewStaffRole('Marshal') }} className="w-full">
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="w-full md:max-w-xs">
                <label className="block text-xs font-semibold text-muted mb-1">Search Staff</label>
                <input 
                  value={staffSearch} 
                  onChange={(e) => setStaffSearch(e.target.value)} 
                  className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-text" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Filter by Role</label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setStaffFilter('all')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${staffFilter === 'all' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>All</button>
                  <button type="button" onClick={() => setStaffFilter('Marshal')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${staffFilter === 'Marshal' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Marshal</button>
                  <button type="button" onClick={() => setStaffFilter('Registrar')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${staffFilter === 'Registrar' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Registrar</button>
                  <button type="button" onClick={() => setStaffFilter('Admin')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${staffFilter === 'Admin' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Admin</button>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">{staffList}</div>
          </>
        )}
      </Card>
      {selectedPlayer ? (
        <div onClick={() => setSelectedPlayer(null)} className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-3xl border border-white/10 bg-background p-4 shadow-[0_30px_80px_rgba(0,0,0,0.75)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold">{selectedPlayer.name}</div>
                <div className="mt-1 text-sm text-muted">Submitted ID preview</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedPlayer.identityDocumentUrl ? (
                  selectedPlayer.verificationStatus === 'pending_review' ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => selectedPlayer.id && handleVerifyPlayer(selectedPlayer.id)}
                        disabled={verifyingId === selectedPlayer.id}
                      >
                        {verifyingId === selectedPlayer.id ? 'Verifying…' : 'Verify ID'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => selectedPlayer.id && handleRejectPlayer(selectedPlayer.id)}
                        disabled={verifyingId === selectedPlayer.id}
                      >
                        {verifyingId === selectedPlayer.id ? 'Rejecting…' : 'Reject ID'}
                      </Button>
                    </>
                  ) : selectedPlayer.verificationStatus === 'verified' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectedPlayer.id && handleSetPlayerVerification(selectedPlayer.id, 'pending_review')}
                      disabled={verifyingId === selectedPlayer.id}
                    >
                      {verifyingId === selectedPlayer.id ? 'Updating…' : 'Mark Pending Review'}
                    </Button>
                  ) : selectedPlayer.verificationStatus === 'rejected' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectedPlayer.id && handleSetPlayerVerification(selectedPlayer.id, 'pending_review')}
                      disabled={verifyingId === selectedPlayer.id}
                    >
                      {verifyingId === selectedPlayer.id ? 'Updating…' : 'Reopen review'}
                    </Button>
                  ) : null
                ) : null}
                <button type="button" onClick={() => setSelectedPlayer(null)} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10">Close</button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Verification</div>
                <div className="mt-2 text-sm">{selectedPlayer.verificationLabel}</div>
                <div className="mt-3 text-xs text-muted">Status: {selectedPlayer.status}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Email</div>
                <div className="mt-2 text-sm">{selectedPlayer.email}</div>
              </div>
            </div>
            <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
              {selectedPlayer.identityDocumentUrl ? (
                <img src={selectedPlayer.identityDocumentUrl} alt="Submitted ID" className="mx-auto max-h-[420px] w-auto rounded-3xl object-contain" />
              ) : (
                <div className="text-sm text-muted">No submitted ID image is available for this player.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}