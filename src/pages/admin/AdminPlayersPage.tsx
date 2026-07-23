import React from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/apiClient'

type PlayerStatus = 'active' | 'pending' | 'suspended'

const StatusBadge = ({ status }: { status: PlayerStatus }) => {

  const cls =
    status === 'active'
      ? 'bg-success/20 text-success border-success/30'
      : status === 'pending'
        ? 'bg-accent/20 text-accent border-accent/30'
        : 'bg-danger/20 text-danger border-danger/30'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}
    >
      {status.toUpperCase()}
    </span>
  )
}

export function AdminPlayersPage() {
  const [status, setStatus] = React.useState<PlayerStatus | 'all'>('all')
  const [players, setPlayers] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [updatingId, setUpdatingId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []

      const normalized = docs
        .filter((d: any) => String(d.role || 'user').toLowerCase() === 'user')
        .map((d: any) => {
        const role = 'user'
        const emailVerified = d.emailVerified === true
        const identityVerificationStatus = String(d.identityVerificationStatus || 'not_submitted')
        const derivedStatus: PlayerStatus =
          d.status === 'active' || d.status === 'pending' || d.status === 'suspended'
            ? d.status
            : emailVerified
              ? 'active'
              : 'pending'

        return {
          ...d,
          id: d.id ?? d.playerId ?? d.accountId ?? (d._id ? String(d._id) : undefined),
          name: d.name || d.fullName || 'Unnamed account',
          email: d.email || 'No email',
          role,
          experience: typeof d.experience === 'number' ? d.experience : 0,
          status: derivedStatus,
          identityVerificationStatus,
          identityVerificationLabel: identityVerificationStatus === 'verified' ? 'Verified' : identityVerificationStatus === 'pending_review' ? 'Pending review' : 'Not submitted',
          waiver: emailVerified ? 'Email verified' : 'Pending verification',
          joinedAt: d.createdAtISO || d.createdAt || null,
        }
      })

      setPlayers(normalized)
    } catch (e: any) {
      setError(String(e?.message || e))
      setPlayers([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  const filtered = status === 'all' ? players : players.filter((p) => p.status === status)

  const handleUpdateVerification = async (playerId: string, identityVerificationStatus: string, newStatus: PlayerStatus) => {
    setUpdatingId(playerId)
    try {
      await apiPut<any>(`/api/user_accounts/${encodeURIComponent(playerId)}`, {
        identityVerificationStatus,
        status: newStatus,
      })
      toast.success(`Player ${newStatus === 'active' ? 'verified & activated' : newStatus === 'suspended' ? 'suspended' : 'updated'}`)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setUpdatingId(null)
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Players</h1>
          <p className="text-muted text-sm mt-1">Manage players, including waivers and access status.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', 'active', 'pending', 'suspended'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (status === s
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {s === 'all' ? 'ALL' : s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/5 bg-white/5/60 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Search</div>
            <div className="mt-2 text-sm text-muted">By name or player ID</div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5/60 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Waivers</div>
            <div className="mt-2 text-sm text-muted">Review / re-verify / flag</div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5/60 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Access</div>
            <div className="mt-2 text-sm text-muted">Activate / suspend</div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-3">Player</div>
            <div className="col-span-2">Experience</div>
            <div className="col-span-3">Email</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.map((p) => (
              <div key={p.id} className="grid grid-cols-12 items-center px-3 py-3">
                <div className="col-span-2 text-sm font-semibold">{p.id}</div>
                <div className="col-span-3">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 text-xs text-muted">{p.role}</div>
                  <div className="mt-1">
                    <StatusBadge status={p.status} />
                  </div>
                </div>
                <div className="col-span-2 text-sm text-muted">{p.experience} pts</div>
                <div className="col-span-3 text-sm text-muted">{p.email}</div>
                <div className="col-span-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-muted hover:bg-white/6 transition">
                      View
                    </button>
                    {p.status === 'active' ? (
                      <button
                        onClick={() => handleUpdateVerification(p.id, 'pending_review', 'suspended')}
                        disabled={updatingId === p.id}
                        className="rounded-xl bg-danger/20 border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/25 transition disabled:opacity-50"
                      >
                        {updatingId === p.id ? 'Processing...' : 'Suspend'}
                      </button>
                    ) : p.status === 'pending' ? (
                      <button
                        onClick={() => handleUpdateVerification(p.id, 'verified', 'active')}
                        disabled={updatingId === p.id}
                        className="rounded-xl bg-success/20 border border-success/30 px-3 py-2 text-xs font-semibold text-success hover:bg-success/25 transition disabled:opacity-50"
                      >
                        {updatingId === p.id ? 'Processing...' : 'Verify & Activate'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateVerification(p.id, 'verified', 'active')}
                        disabled={updatingId === p.id}
                        className="rounded-xl bg-accent/20 border border-accent/30 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25 transition disabled:opacity-50"
                      >
                        {updatingId === p.id ? 'Processing...' : 'Reinstate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-6 text-sm text-muted">No players match this filter.</div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">Page 1 of 3</div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl bg-white/5 border border-white/5 px-4 py-2 text-sm text-muted hover:bg-white/6 transition">
              Previous
            </button>
            <button className="rounded-xl bg-white/5 border border-white/5 px-4 py-2 text-sm text-muted hover:bg-white/6 transition">
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}


