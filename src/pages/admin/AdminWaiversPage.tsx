import React from 'react'
import { createPortal } from 'react-dom'
import { FiEye, FiShield, FiX } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPut } from '../../utils/apiClient'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type WaiverRecord = {
  id?: string
  _id?: string
  userId?: string
  reservationId?: string
  fullName?: string
  age?: number
  guardianName?: string
  guardianConsent?: boolean
  consent?: boolean
  termsAccepted?: boolean
  isMinor?: boolean
  hasSignature?: boolean
  status?: string
  submittedAtISO?: string
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function AdminWaiversPage() {
  const [waivers, setWaivers] = React.useState<WaiverRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [selectedWaiver, setSelectedWaiver] = React.useState<WaiverRecord | null>(null)
  const [savingStatus, setSavingStatus] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiGet<{ ok: boolean; data: WaiverRecord[] }>('/api/waivers?limit=200')
      setWaivers(Array.isArray(response?.data) ? response.data : [])
    } catch {
      setWaivers([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  const { addNotification } = useNotifications()

  const updateWaiverStatus = React.useCallback(async (status: 'approved' | 'denied') => {
    if (!selectedWaiver) return
    const waiverId = selectedWaiver.id || selectedWaiver._id
    if (!waiverId) return

    setSavingStatus(true)
    try {
      const response = await apiPut<{ ok: boolean; data: WaiverRecord }>(`/api/waivers/${encodeURIComponent(String(waiverId))}`, {
        status,
      })

      if (response?.data) {
        setSelectedWaiver(response.data)
        setWaivers((current) => current.map((waiver) => (waiver.id === waiverId || waiver._id === waiverId ? response.data : waiver)))

        sendRoleNotifications(addNotification, {
          roles: ['admin', 'registrar', 'marshal'],
          type: status === 'approved' ? 'waiver_approved' : 'waiver_denied',
          title: status === 'approved' ? 'Waiver Approved' : 'Waiver Denied',
          message: status === 'approved'
            ? `Waiver ${waiverId} was approved.`
            : `Waiver ${waiverId} was denied.`,
          linkedResourceId: waiverId,
        })

        // Notify the player
        if (selectedWaiver.userId) {
          addNotification({
            userId: selectedWaiver.userId,
            type: status === 'approved' ? 'waiver_approved' : 'waiver_denied',
            title: status === 'approved' ? 'Waiver Approved' : 'Waiver Denied',
            message: status === 'approved'
              ? 'Your waiver has been approved. You can now proceed with your reservation.'
              : 'Your waiver has been denied. Please check with the admin for more details.',
            linkedResourceId: waiverId,
          })
        }
      }
    } catch {
      // ignore for now
    } finally {
      setSavingStatus(false)
    }
  }, [selectedWaiver])

  const approveWaiver = React.useCallback(() => updateWaiverStatus('approved'), [updateWaiverStatus])
  const denyWaiver = React.useCallback(() => updateWaiverStatus('denied'), [updateWaiverStatus])

  const filtered = waivers.filter((waiver) => {
    const term = query.trim().toLowerCase()
    if (!term) return true
    return [waiver.id, waiver.userId, waiver.reservationId, waiver.fullName, waiver.status]
      .some((value) => String(value || '').toLowerCase().includes(term))
  })

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted"><FiShield className="text-accent" /> Admin records</div>
        <h1 className="mt-2 text-3xl font-bold">Submitted Waivers</h1>
        <p className="mt-1 text-sm text-muted">All player waivers submitted through the online waiver form.</p>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Waiver table</div>
            <div className="mt-1 text-sm text-muted">{waivers.length} waiver records stored in MongoDB</div>
          </div>
          <div className="md:w-96"><Input label="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, player ID, reservation, or status" /></div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-widest text-muted"><th className="py-3 pr-4">Waiver</th><th className="py-3 pr-4">Player</th><th className="py-3 pr-4">Submitted</th><th className="py-3 pr-4">Status</th><th className="py-3 text-right">Action</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="py-8 text-center text-muted">Loading waivers...</td></tr> : null}
              {!loading && filtered.map((waiver) => <tr key={waiver.id || waiver._id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-semibold">{waiver.id || waiver._id}</div><div className="text-xs text-muted">Reservation: {waiver.reservationId || '-'}</div></td><td className="py-3 pr-4"><div className="font-semibold">{waiver.fullName || '-'}</div><div className="text-xs text-muted">{waiver.userId || 'Guest submission'}</div></td><td className="py-3 pr-4 text-muted">{formatDate(waiver.submittedAtISO)}</td><td className="py-3 pr-4"><span className={`${waiver.status === 'approved' ? 'rounded-full border border-success/30 bg-success/10 text-success' : waiver.status === 'denied' ? 'rounded-full border border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200' : 'rounded-full border border-accent/30 bg-accent/10 text-accent'} px-2 py-1 text-[11px] font-semibold uppercase`}>{waiver.status || 'pending'}</span></td><td className="py-3 text-right"><button type="button" onClick={() => setSelectedWaiver(waiver)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted hover:bg-white/10"><FiEye /> View</button></td></tr>)}
              {!loading && filtered.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-muted">No waivers found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedWaiver ? createPortal(
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="waiver-details-title">
          <article className="max-h-[90vh] w-full max-w-5xl overflow-y-auto bg-white text-slate-950 dark:bg-slate-950 dark:text-white p-6 shadow-none">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">Waiver document</div>
                <h2 id="waiver-details-title" className="mt-1 text-2xl font-semibold">{selectedWaiver.fullName || 'Unnamed player'}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This view displays the submitted waiver in a plain document style.</p>
              </div>
              <button type="button" aria-label="Close waiver details" onClick={() => setSelectedWaiver(null)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><FiX /></button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Waiver ID</div>
                <p className="mt-1 font-medium">{selectedWaiver.id || selectedWaiver._id || '-'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Submitted</div>
                <p className="mt-1 font-medium">{formatDate(selectedWaiver.submittedAtISO)}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Player ID</div>
                <p className="mt-1 font-medium">{selectedWaiver.userId || 'Guest submission'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Status</div>
                <p className="mt-1 font-medium">{selectedWaiver.status || 'pending'}</p>
              </div>
            </div>

            <div className="pt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="uppercase tracking-widest text-[11px] text-slate-500">Participant details</p>
              <p className="mt-3"><span className="font-semibold">Name:</span> {selectedWaiver.fullName || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Age:</span> {selectedWaiver.age ?? '-'}</p>
              <p className="mt-2"><span className="font-semibold">Reservation:</span> {selectedWaiver.reservationId || '-'}</p>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Guardian information</p>
              {selectedWaiver.isMinor ? (
                <>
                  <p className="mt-3"><span className="font-semibold">Guardian name:</span> {selectedWaiver.guardianName || '-'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian consent:</span> {selectedWaiver.guardianConsent ? 'Yes' : 'No'}</p>
                </>
              ) : (
                <p className="mt-3">Not required for participants 18 or older.</p>
              )}

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Consent summary</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Terms accepted: {selectedWaiver.termsAccepted ? 'Yes' : 'No'}</li>
                <li>Participation consent: {selectedWaiver.consent ? 'Yes' : 'No'}</li>
                <li>Signature captured: {selectedWaiver.hasSignature ? 'Yes' : 'No'}</li>
              </ul>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Waiver terms</p>
              <div className="mt-3 space-y-3">
                <p>I understand that airsoft activity involves risks including, but not limited to, injury and property damage.</p>
                <p>I agree to follow marshals’ instructions, safety rules, and field procedures at all times.</p>
                <p>I acknowledge that protective gear is mandatory and that non-compliance may result in removal from the field.</p>
                {selectedWaiver.isMinor ? <p>As a parent/guardian, I provide consent for my minor to participate and agree to uphold compliance with safety requirements.</p> : null}
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200/70 pt-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  <p><span className="font-semibold text-slate-700 dark:text-slate-200">Document reference:</span> {selectedWaiver.id || selectedWaiver._id || '-'}</p>
                  <p className="mt-2"><span className="font-semibold text-slate-700 dark:text-slate-200">Displayed as:</span> waiver document view</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={denyWaiver}
                    disabled={savingStatus || selectedWaiver.status === 'denied'}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-transparent px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {selectedWaiver.status === 'denied' ? 'Denied' : savingStatus ? 'Updating...' : 'Deny waiver'}
                  </button>
                  <button
                    type="button"
                    onClick={approveWaiver}
                    disabled={savingStatus || selectedWaiver.status === 'approved'}
                    className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-white/10"
                  >
                    {selectedWaiver.status === 'approved' ? 'Approved' : savingStatus ? 'Updating...' : 'Approve waiver'}
                  </button>
                </div>
              </div>
            </div>
          </article>
        </div>,
        typeof document !== 'undefined' ? document.body : document.createElement('div'),
      ) : null}
    </div>
  )
}
