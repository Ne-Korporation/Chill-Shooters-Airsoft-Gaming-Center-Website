import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { apiGet, apiPut } from '../../utils/apiClient'

export type GuardianApprovalSummary = {
  required: number
  approved: number
  declined: number
  pending: number
  status: 'none' | 'pending' | 'approved' | 'declined'
}

type Approval = {
  id: string
  minorName: string
  guardianName: string
  guardianEmail: string
  status: 'pending' | 'approved' | 'declined'
  note?: string
}

const tone: Record<string, string> = {
  approved: 'border-success/30 bg-success/15 text-success',
  declined: 'border-danger/30 bg-danger/15 text-danger',
  pending: 'border-warning/30 bg-warning/15 text-warning',
}

// Shows whether every minor on a booking has guardian approval (required before confirming),
// and lets the registrar record an approval given in person at the counter.
export function GuardianApprovalBadge({
  reservationId,
  summary,
  canRecordInPerson,
  onChanged,
}: {
  reservationId: string
  summary?: GuardianApprovalSummary | null
  canRecordInPerson: boolean
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Approval[] | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  if (!summary || summary.status === 'none' || summary.required === 0) return null

  const load = async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: Approval[] }>(`/api/reservations/${encodeURIComponent(reservationId)}/guardian-approvals`)
      setItems(res.data)
    } catch (e: any) {
      toast.error(e?.message || 'Could not load guardian approvals')
    }
  }

  const recordInPerson = async (approval: Approval) => {
    const note = window.prompt(`How did ${approval.guardianName || 'the guardian'} approve ${approval.minorName}? (e.g. "Mother present, showed driver's license")`)
    if (!note?.trim()) return
    setSavingId(approval.id)
    try {
      await apiPut(`/api/guardian-approvals/${encodeURIComponent(approval.id)}/in-person`, { note })
      toast.success('Guardian approval recorded.')
      await load()
      onChanged?.()
    } catch (e: any) {
      toast.error(e?.message || 'Could not record the approval')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
          if (!items) void load()
        }}
        className={`rounded-xl border px-2 py-0.5 text-[11px] font-semibold ${tone[summary.status] || tone.pending}`}
      >
        Guardian {summary.approved}/{summary.required} approved{summary.declined ? ' · declined' : ''}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 text-xs">
          {(items || []).map((approval) => (
            <li key={approval.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="font-semibold">{approval.minorName} · <span className="capitalize">{approval.status}</span></div>
              <div className="text-muted">{approval.guardianName || 'Guardian'} · {approval.guardianEmail || 'no email on file'}</div>
              {approval.note ? <div className="text-muted">Note: {approval.note}</div> : null}
              {canRecordInPerson && approval.status !== 'approved' ? (
                <button
                  type="button"
                  disabled={savingId === approval.id}
                  onClick={() => recordInPerson(approval)}
                  className="mt-1 rounded-lg border border-white/10 px-2 py-0.5 font-semibold hover:bg-white/10 disabled:opacity-50"
                >
                  {savingId === approval.id ? 'Saving…' : 'Approved in person'}
                </button>
              ) : null}
            </li>
          ))}
          {items && items.length === 0 ? <li className="text-muted">No approvals found.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
