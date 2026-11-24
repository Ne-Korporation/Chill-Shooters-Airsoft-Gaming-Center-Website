import React from 'react'
import { formatDateTime } from '../../utils/dates'

type Staff = { role?: string; name?: string; email?: string }

// The parts of a waiver that matter for reviewing it but aren't on the printed document. Every
// field is optional: it's the waiver record as the API returns it.
export type ReviewableWaiver = {
  status?: string
  archived?: boolean
  archivedReason?: string
  archivedAtISO?: string
  archivedBy?: Staff
  supersededBy?: string
  autoApproved?: boolean
  submittedAtISO?: string
  userId?: string
  email?: string
  validUntilISO?: string
  idType?: string
  idChecked?: boolean
  isMinor?: boolean
  guardianIdType?: string
  guardianIdChecked?: boolean
  guardianEmail?: string
  termsAccepted?: boolean
  consent?: boolean
  hasSignature?: boolean
  reviewedBy?: Staff
  reviewedAtISO?: string
  editHistory?: Array<{ atISO: string; by?: { email?: string }; fields: Record<string, { from: unknown; to: unknown }> }>
}

function staffLabel(by?: Staff) {
  if (!by) return ''
  const role = by.role ? `${by.role.charAt(0).toUpperCase()}${by.role.slice(1)}` : ''
  return [role, by.name || by.email || ''].filter(Boolean).join(' ')
}

// Shown above the waiver document in the admin and registrar waiver windows: where the waiver
// stands, who reviewed it, the checks and consents, and its history. Labels sit above values so
// long ones (emails) wrap instead of running into the next column.
export function WaiverReviewPanel({ waiver }: { waiver: ReviewableWaiver }) {
  const status = String(waiver.status || 'pending').toLowerCase()
  const tone = status === 'approved' ? 'border-success/30 bg-success/10 text-success'
    : status === 'denied' ? 'border-danger/30 bg-danger/10 text-danger'
      : 'border-accent/30 bg-accent/10 text-accent'
  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0 border-b border-white/5 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 break-words text-sm font-semibold">{value}</div>
    </div>
  )
  const checked = <span className="ml-1.5 text-xs font-semibold text-success">Checked</span>
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${tone}`}>{status}</span>
        {waiver.archived ? <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-muted">Archived</span> : null}
        {waiver.autoApproved ? <span className="text-xs font-semibold text-success">Approved automatically: the ID was verified on the player's profile.</span> : null}
      </div>
      <div className="mt-1 grid sm:grid-cols-2 sm:gap-x-6">
        {fact('Submitted', formatDateTime(waiver.submittedAtISO))}
        {fact('Player ID', waiver.userId || 'Guest submission')}
        {fact('Email', waiver.email || '—')}
        {waiver.validUntilISO ? fact('Valid until', formatDateTime(waiver.validUntilISO)) : null}
        {fact('ID', <>{waiver.idType || '—'}{waiver.idChecked ? checked : null}</>)}
        {waiver.isMinor ? fact('Guardian ID', <>{waiver.guardianIdType || '—'}{waiver.guardianIdChecked ? checked : null}</>) : null}
        {waiver.isMinor ? fact('Guardian email', waiver.guardianEmail || '—') : null}
        {fact('Consent', [waiver.termsAccepted ? 'Terms' : '', waiver.consent ? 'Participation' : '', waiver.hasSignature ? 'Signed' : ''].filter(Boolean).join(' · ') || 'None recorded')}
      </div>
      {waiver.reviewedBy ? (
        <p className="mt-2 text-xs text-muted">Reviewed by {staffLabel(waiver.reviewedBy)}{waiver.reviewedAtISO ? ` · ${formatDateTime(waiver.reviewedAtISO)}` : ''}</p>
      ) : null}
      {waiver.archived ? (
        <p className="mt-1 text-xs text-muted">
          {waiver.archivedReason === 'resubmitted'
            ? `Replaced by the player's resubmitted waiver ${waiver.supersededBy || ''}`
            : waiver.archivedReason === 'removed_by_guardian'
              ? "The guardian removed this minor from their account. Unarchiving keeps the record but doesn't add the minor back to their account."
              : `Archived by ${staffLabel(waiver.archivedBy) || 'staff'}`}
          {waiver.archivedAtISO ? ` · ${formatDateTime(waiver.archivedAtISO)}` : ''}
        </p>
      ) : null}
      {waiver.editHistory?.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-muted">Edit history ({waiver.editHistory.length})</summary>
          <ul className="mt-2 space-y-2">
            {[...waiver.editHistory].reverse().map((entry, index) => (
              <li key={index} className="rounded-lg border border-white/10 p-2">
                <div className="font-semibold">{formatDateTime(entry.atISO)}{entry.by?.email ? ` · ${entry.by.email}` : ''}</div>
                {Object.entries(entry.fields).map(([field, change]) => (
                  <div key={field}>{field}: “{String(change.from ?? '')}” → “{String(change.to ?? '')}”</div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
