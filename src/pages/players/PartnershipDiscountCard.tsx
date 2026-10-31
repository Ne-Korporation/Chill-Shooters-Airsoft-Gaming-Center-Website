import React from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiBase, apiGet, apiPost, getApiAuthHeaders } from '../../utils/apiClient'

type Institution = { name: string; discountPercent: number }

type Props = {
  institution?: string
  status?: string
  reviewReason?: string
  onSubmitted: (next: { partnershipInstitution: string; partnershipEligibilityStatus: string }) => void
}

export function PartnershipDiscountCard({ institution, status, reviewReason, onSubmitted }: Props) {
  // Partner organizations with a discount, set by the admin on the Partnerships page.
  const [institutions, setInstitutions] = React.useState<Institution[]>([])
  const [selected, setSelected] = React.useState(institution || '')
  React.useEffect(() => {
    apiGet<{ ok: boolean; data: Institution[] }>('/api/partnership-discount/institutions')
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : []
        setInstitutions(list)
        setSelected((current) => (list.some((entry) => entry.name === current) ? current : list[0]?.name || ''))
      })
      .catch(() => setInstitutions([]))
  }, [])
  const [file, setFile] = React.useState<File | null>(null)
  const [saving, setSaving] = React.useState(false)
  const normalized = String(status || '').toLowerCase()

  const submit = async () => {
    if (!file) {
      toast.error('Attach a photo of your school ID.')
      return
    }
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const uploadRes = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
      const uploadJson = await uploadRes.json().catch(() => null)
      if (!uploadRes.ok || !uploadJson?.url) throw new Error(uploadJson?.error || 'Upload failed')

      const res = await apiPost<{ ok: boolean; data: { partnershipInstitution: string; partnershipEligibilityStatus: string } }>(
        '/api/partnership-discount/request',
        { institution: selected, proofUrl: uploadJson.url },
      )
      toast.success('Discount request sent for staff review.')
      setFile(null)
      onSubmitted(res.data)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to submit request')
    } finally {
      setSaving(false)
    }
  }

  const badge = normalized === 'verified'
    ? { text: 'Verified', cls: 'border-success/30 bg-success/20 text-success' }
    : normalized === 'pending'
      ? { text: 'Pending review', cls: 'border-accent/30 bg-accent/20 text-accent' }
      : normalized === 'rejected'
        ? { text: 'Rejected', cls: 'border-danger/30 bg-danger/20 text-danger' }
        : { text: 'Not requested', cls: 'border-white/10 bg-white/5 text-muted' }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Partnership Discount</div>
          <div className="mt-1 text-sm text-muted">
            Students and staff of partner schools get a discount on rentals once staff verify their school ID.
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badge.cls}`}>{badge.text}</span>
      </div>

      {normalized === 'verified' ? (
        <div className="mt-3 text-sm text-success">{institution} discount is applied automatically to your reservations.</div>
      ) : normalized === 'pending' ? (
        <div className="mt-3 text-sm text-muted">Your {institution} request is waiting for staff review.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {normalized === 'rejected' && reviewReason ? (
            <div className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">Previous request rejected: {reviewReason}</div>
          ) : null}
          {institutions.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted">No partner discounts are open right now.</div>
          ) : null}
          <label className="block">
            <div className="mb-2 text-sm font-semibold text-text">Organization</div>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background"
            >
              {institutions.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.discountPercent}% off)</option>)}
            </select>
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-semibold text-text">School ID photo</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-text"
            />
          </label>
          <Button type="button" className="w-full" onClick={submit} disabled={saving || !file || !selected}>
            {saving ? 'Submitting…' : 'Request discount'}
          </Button>
        </div>
      )}
    </Card>
  )
}
