import React from 'react'
import { FiEye, FiShield, FiX } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { apiGet } from '../../utils/apiClient'

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
              {!loading && filtered.map((waiver) => <tr key={waiver.id || waiver._id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-semibold">{waiver.id || waiver._id}</div><div className="text-xs text-muted">Reservation: {waiver.reservationId || '-'}</div></td><td className="py-3 pr-4"><div className="font-semibold">{waiver.fullName || '-'}</div><div className="text-xs text-muted">{waiver.userId || 'Guest submission'}</div></td><td className="py-3 pr-4 text-muted">{formatDate(waiver.submittedAtISO)}</td><td className="py-3 pr-4"><span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-semibold uppercase text-accent">{waiver.status || 'pending'}</span></td><td className="py-3 text-right"><button type="button" onClick={() => setSelectedWaiver(waiver)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted hover:bg-white/10"><FiEye /> View</button></td></tr>)}
              {!loading && filtered.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-muted">No waivers found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedWaiver ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="waiver-details-title"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-background p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><div className="text-xs uppercase tracking-widest text-muted">Waiver details</div><h2 id="waiver-details-title" className="mt-1 text-xl font-bold">{selectedWaiver.fullName || 'Unnamed player'}</h2></div><button type="button" aria-label="Close waiver details" onClick={() => setSelectedWaiver(null)} className="rounded-lg p-2 text-muted hover:bg-white/10"><FiX /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Detail label="Waiver ID" value={selectedWaiver.id || selectedWaiver._id} /><Detail label="Player ID" value={selectedWaiver.userId} /><Detail label="Reservation ID" value={selectedWaiver.reservationId} /><Detail label="Submitted" value={formatDate(selectedWaiver.submittedAtISO)} /><Detail label="Age" value={selectedWaiver.age} /><Detail label="Status" value={selectedWaiver.status || 'pending'} /><Detail label="Guardian" value={selectedWaiver.isMinor ? selectedWaiver.guardianName : 'Not required'} /><Detail label="Signature" value={selectedWaiver.hasSignature ? 'Captured' : 'Not recorded'} /></div><div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted"><div>Guardian consent: {selectedWaiver.guardianConsent ? 'Yes' : 'No'}</div><div className="mt-1">Terms accepted: {selectedWaiver.termsAccepted ? 'Yes' : 'No'}</div><div className="mt-1">Participation consent: {selectedWaiver.consent ? 'Yes' : 'No'}</div></div></div></div> : null}
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-widest text-muted">{label}</div><div className="mt-1 text-sm font-semibold">{value || '-'}</div></div>
}
