import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiCheckCircle, FiShield, FiXCircle } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import { OFFICIAL_WAIVER_TEXT } from '../../utils/waiverText'

type ApprovalData = {
  status: 'pending' | 'approved' | 'declined'
  decidedAtISO: string | null
  minor: { fullName: string; birthDate: string; age: number | null; email: string }
  guardian: { name: string; phone: string; email: string }
  reservation: {
    id: string
    reservationDate: string
    reservationTime: string
    locationName: string
    packageName: string
    numberOfPlayers: number
    totalAmount: number
    reservationStatus: string
  } | null
  waiver: {
    id: string
    submittedAtISO: string
    signatureImage: string
    guardianSignatureImage: string
    termsAccepted: boolean
    guardianConsent: boolean
  } | null
}

function Row({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2 text-sm ${highlight ? 'font-semibold text-gold' : ''}`}>
      <span className="text-muted">{label}</span>
      <span className="text-right">{value || '—'}</span>
    </div>
  )
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Public page a guardian opens from the approval email (no account needed). It shows what the
// minor entered about themselves and their guardian, the booking, and the signed waiver.
export function GuardianApprovalPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<ApprovalData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiGet<{ ok: boolean; data: ApprovalData }>(`/api/guardian-approvals/${encodeURIComponent(token)}`)
      .then((res) => setData(res.data))
      .catch((e: any) => setError(e?.message || 'This approval link is invalid or has expired.'))
  }, [token])

  const decide = async (decision: 'approved' | 'declined') => {
    if (decision === 'approved' && !confirmed) {
      toast.error('Please confirm the details above first.')
      return
    }
    setSubmitting(true)
    try {
      await apiPost(`/api/guardian-approvals/${encodeURIComponent(token)}`, { decision, note })
      setData((current) => (current ? { ...current, status: decision, decidedAtISO: new Date().toISOString() } : current))
      toast.success(decision === 'approved' ? 'Booking approved. Thank you!' : 'Booking declined.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not save your answer.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-accent"><FiShield /> Chill Shooters Airsoft Gaming Center</div>
          <h1 className="mt-2 text-3xl font-bold">Guardian approval</h1>
          <p className="mt-1 text-sm text-muted">Players under 18 need a parent or guardian to approve every booking.</p>
        </div>

        {error ? <Card className="p-5 text-sm text-danger">{error}</Card> : null}
        {!data && !error ? <Card className="p-5 text-sm text-muted">Loading…</Card> : null}

        {data ? (
          <>
            {data.status !== 'pending' ? (
              <Card className={`flex items-center gap-3 p-4 text-sm ${data.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                {data.status === 'approved' ? <FiCheckCircle className="text-xl" /> : <FiXCircle className="text-xl" />}
                You {data.status} this booking{data.decidedAtISO ? ` on ${formatDate(data.decidedAtISO)}` : ''}.
              </Card>
            ) : null}

            <Card className="p-5">
              <div className="text-xs uppercase tracking-widest text-muted">Player details (entered by the player)</div>
              <div className="mt-2 divide-y divide-white/10">
                <Row label="Name" value={data.minor.fullName} />
                <Row label="Birthday" value={formatDate(data.minor.birthDate)} />
                <Row label="Age" value={data.minor.age ?? ''} />
                <Row label="Email" value={data.minor.email} />
              </div>
              <div className="mt-4 text-xs uppercase tracking-widest text-muted">Guardian details they gave us</div>
              <div className="mt-2 divide-y divide-white/10">
                <Row label="Guardian name" value={data.guardian.name} />
                <Row label="Guardian phone number" value={data.guardian.phone} highlight />
                <Row label="Guardian email" value={data.guardian.email} />
              </div>
              <p className="mt-3 text-xs text-muted">Please make sure the phone number is yours. We call this number in an emergency.</p>
            </Card>

            {data.reservation ? (
              <Card className="p-5">
                <div className="text-xs uppercase tracking-widest text-muted">Booking</div>
                <div className="mt-2 divide-y divide-white/10">
                  <Row label="Date" value={formatDate(data.reservation.reservationDate)} />
                  <Row label="Time slot" value={<span className="capitalize">{data.reservation.reservationTime}</span>} />
                  <Row label="Location" value={data.reservation.locationName} />
                  <Row label="Package" value={data.reservation.packageName} />
                  <Row label="Players on the booking" value={data.reservation.numberOfPlayers} />
                  <Row label="Total" value={`₱${Number(data.reservation.totalAmount || 0).toLocaleString('en-PH')}`} />
                  <Row label="Reservation ID" value={data.reservation.id} />
                </div>
              </Card>
            ) : null}

            {data.waiver ? (
              <Card className="p-5">
                <div className="text-xs uppercase tracking-widest text-muted">Signed waiver</div>
                <p className="mt-1 text-xs text-muted">Submitted {formatDate(data.waiver.submittedAtISO)}</p>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed">
                  <p className="font-semibold">{OFFICIAL_WAIVER_TEXT.preamble}</p>
                  <p>{OFFICIAL_WAIVER_TEXT.intro}</p>
                  <ol className="list-decimal space-y-2 pl-5">
                    {OFFICIAL_WAIVER_TEXT.clauses.map((clause, index) => <li key={index}>{clause}</li>)}
                  </ol>
                  <p className="font-semibold">{OFFICIAL_WAIVER_TEXT.closing}</p>
                  <p className="font-semibold">{OFFICIAL_WAIVER_TEXT.guardianTitle}</p>
                  <p>{OFFICIAL_WAIVER_TEXT.guardianCertification}</p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[['Player signature', data.waiver.signatureImage], ['Guardian signature', data.waiver.guardianSignatureImage]].map(([label, src]) => (
                    <div key={label}>
                      <div className="text-xs text-muted">{label}</div>
                      {src ? <img src={src} alt={label} className="mt-1 h-20 w-full rounded-lg bg-white object-contain p-1" /> : <div className="mt-1 text-xs text-muted">Not provided</div>}
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {data.status === 'pending' ? (
              <Card className="space-y-4 p-5">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>I am {data.minor.fullName || 'this player'}'s parent or guardian, the details above are correct, and I allow them to play in this booking.</span>
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold">Note (optional)</div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., a correction to the phone number"
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="ghost" className="flex-1" disabled={submitting} onClick={() => decide('declined')}><FiXCircle /> Decline</Button>
                  <Button className="flex-1" disabled={submitting || !confirmed} onClick={() => decide('approved')}><FiCheckCircle /> Approve booking</Button>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
