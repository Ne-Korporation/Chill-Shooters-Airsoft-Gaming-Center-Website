import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FiCheck, FiShield, FiClock, FiAlertTriangle } from 'react-icons/fi'
import { apiGet, apiPut } from '../../utils/apiClient'
import { WaiverApprovalDialog } from '../../components/waivers/WaiverApprovalDialog'

type WaiverStatus = 'pending' | 'accepted' | 'flagged' | 'expired'

type WaiverRow = {
  id: string
  submittedAtISO: string
  reservationId: string
  participantSummary: string
  isMinor: boolean
  status: WaiverStatus
  reviewerNote: string
  fullName: string
  guardianIdImage: string
}

function dateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function normalizeStatus(value?: string): WaiverStatus {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'approved' || raw === 'accepted') return 'accepted'
  if (raw === 'denied' || raw === 'flagged') return 'flagged'
  // Older than 12 months: the player has to answer a new waiver, so there is nothing to review.
  if (raw === 'expired') return 'expired'
  return 'pending'
}

export function RegistrarSubmittedWaiversPage() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<WaiverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200')
      const mapped = (Array.isArray(res?.data) ? res.data : []).map((item) => ({
        id: String(item.id || item._id || ''),
        submittedAtISO: item.submittedAtISO || item.createdAtISO || '',
        reservationId: String(item.reservationId || ''),
        participantSummary: item.fullName ? `${item.fullName}${item.age ? ` (Age ${item.age})` : ''}` : '—',
        isMinor: Boolean(item.isMinor || Number(item.age) < 18),
        status: normalizeStatus(item.status),
        reviewerNote: item.reviewerNote || '',
        fullName: item.fullName || 'this player',
        guardianIdImage: item.guardianIdImage || '',
      }))
      setRows(mapped)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.reservationId.toLowerCase().includes(q) ||
        r.participantSummary.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      )
    })
  }, [query, rows])

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows])
  const flaggedCount = useMemo(() => rows.filter((r) => r.status === 'flagged').length, [rows])

  const [approving, setApproving] = useState<{ row: WaiverRow; note: string } | null>(null)

  const updateStatus = async (id: string, nextStatus: WaiverStatus, reviewerNote: string, idCheck?: { idType: string; idChecked: true }) => {
    setSavingId(id)
    try {
      await apiPut(`/api/waivers/${encodeURIComponent(id)}`, {
        status: nextStatus === 'accepted' ? 'approved' : 'denied',
        reviewerNote,
        ...(idCheck || {}),
      })
      toast.success(`Waiver ${nextStatus === 'accepted' ? 'accepted' : 'flagged'}`)
      setApproving(null)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSavingId(null)
    }
  }

  // Accepting opens the ID check first; the waiver is only approved once the ID is confirmed.
  const accept = (row: WaiverRow) => setApproving({ row, note: 'Waiver accepted by registrar.' })
  const clearFlag = (row: WaiverRow) => setApproving({ row, note: 'Flag cleared after verification.' })

  return (
    <div className="space-y-4">
      <WaiverApprovalDialog
        key={approving?.row.id || 'closed'}
        open={Boolean(approving)}
        participant={approving?.row.fullName || ''}
        isMinor={Boolean(approving?.row.isMinor)}
        guardianIdImage={approving?.row.guardianIdImage}
        busy={Boolean(approving && savingId === approving.row.id)}
        onCancel={() => setApproving(null)}
        onConfirm={(check) => approving && void updateStatus(approving.row.id, 'accepted', approving.note, check)}
      />
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Registrar</div>
        <h1 className="text-3xl font-bold">Submitted Online Waivers</h1>
        <p className="text-muted text-sm">Review waiver submissions and accept/flag (prototype state-only).</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending</div>
          <div className="mt-2 text-2xl font-bold text-accent">{pendingCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Flagged</div>
          <div className="mt-2 text-2xl font-bold text-danger">{flaggedCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Accepted</div>
          <div className="mt-2 text-2xl font-bold text-success">{rows.filter((r) => r.status === 'accepted').length}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FiShield /> <span>Waiver queue</span>
          </div>

          <div className="md:w-[420px]">
            <Input
              label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="waiver id / reservation id / participant / status"
            />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">Waiver</th>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 pr-3">Reservation</th>
                <th className="py-2 pr-3">Participant</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-muted">
                    Loading waivers…
                  </td>
                </tr>
              ) : null}

              {!loading && filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.id}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{dateTime(r.submittedAtISO)}</div>
                    <div className="mt-1 text-xs text-muted flex items-center gap-2">
                      <FiClock /> {r.isMinor ? 'Minor consent included' : 'Adult waiver'}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.reservationId}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.participantSummary}</div>
                    {r.reviewerNote ? <div className="mt-1 text-xs text-muted">{r.reviewerNote}</div> : null}
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
                        r.status === 'accepted'
                          ? 'bg-success/15 text-success border-success/30'
                          : r.status === 'flagged'
                            ? 'bg-danger/15 text-danger border-danger/30'
                            : 'bg-accent/15 text-gold border-accent/30',
                      ].join(' ')}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {r.status === 'pending' ? (
                        <Button variant="primary" className="w-full sm:w-auto" onClick={() => accept(r)} disabled={savingId === r.id}>
                          <FiCheck /> {savingId === r.id ? 'Saving…' : 'Accept'}
                        </Button>
                      ) : null}
                      {r.status === 'flagged' ? (
                        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => clearFlag(r)} disabled={savingId === r.id}>
                          <FiAlertTriangle /> {savingId === r.id ? 'Saving…' : 'Re-verify'}
                        </Button>
                      ) : null}
                      {r.status === 'accepted' ? <div className="text-xs text-muted">No action</div> : null}
                      {r.status === 'expired' ? <div className="text-xs text-muted">Player must submit a new waiver</div> : null}
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-muted">
                    No waivers match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

