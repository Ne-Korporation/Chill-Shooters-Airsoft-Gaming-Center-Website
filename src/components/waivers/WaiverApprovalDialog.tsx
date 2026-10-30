import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { selectClass } from '../../pages/operations/shared'
import { ACCEPTED_ID_TYPES } from '../../utils/idTypes'

export type WaiverIdCheck = { idType?: string; idChecked: true; guardianIdChecked?: true }

export type WaiverForIdCheck = {
  fullName?: string
  isMinor?: boolean
  idType?: string
  idImage?: string
  guardianName?: string
  guardianIdType?: string
  guardianIdImage?: string
}

type Checks = { readable: boolean; notExpired: boolean; matches: boolean }
const NO_CHECKS: Checks = { readable: false, notExpired: false, matches: false }
const allChecked = (checks: Checks) => checks.readable && checks.notExpired && checks.matches

// One ID to verify: the type the person said it is, their photo of it, and the reviewer's checks.
function IdCheckSection({
  heading,
  claimedType,
  image,
  matchLabel,
  checks,
  onToggle,
  legacyType,
  onLegacyType,
}: {
  heading: string
  claimedType?: string
  image?: string
  matchLabel: string
  checks: Checks
  onToggle: (key: keyof Checks) => void
  legacyType?: string
  onLegacyType?: (value: string) => void
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-sm font-bold">{heading}</div>
      {claimedType ? (
        <div className="text-sm">
          <span className="text-muted">ID type they selected: </span>
          <span className="font-semibold">{claimedType}</span>
        </div>
      ) : onLegacyType ? (
        // Waivers submitted before players chose their ID type.
        <label className="block">
          <div className="mb-1 text-xs text-muted">This older waiver has no ID type. Select the ID you checked:</div>
          <select value={legacyType} onChange={(e) => onLegacyType(e.target.value)} className={selectClass}>
            <option value="">Select the ID…</option>
            {ACCEPTED_ID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      ) : null}
      {image ? (
        <a href={image} target="_blank" rel="noreferrer">
          <img src={image} alt={heading} className="max-h-48 w-full rounded-xl border border-white/10 bg-white object-contain" />
        </a>
      ) : (
        <div className="text-xs text-muted">No ID photo attached. Check the ID in person at the counter.</div>
      )}
      <div className="space-y-2 text-sm">
        {([
          ['readable', 'The ID photo is clear and readable'],
          ['notExpired', 'The ID is not expired'],
          ['matches', matchLabel],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={checks[key]} onChange={() => onToggle(key)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

// Approval criteria: the reviewer checks the ID the participant attached (and, for a minor,
// the guardian's ID) against what they claimed. The server enforces the same rule.
export function WaiverApprovalDialog({
  open,
  waiver,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  waiver: WaiverForIdCheck | null
  busy?: boolean
  onConfirm: (check: WaiverIdCheck) => void
  onCancel: () => void
}) {
  const [playerChecks, setPlayerChecks] = useState<Checks>(NO_CHECKS)
  const [guardianChecks, setGuardianChecks] = useState<Checks>(NO_CHECKS)
  const [legacyType, setLegacyType] = useState('')
  if (!open || !waiver || typeof document === 'undefined') return null

  const participant = waiver.fullName || 'this player'
  const isMinor = Boolean(waiver.isMinor)
  const needsLegacyType = !waiver.idType
  const ready = allChecked(playerChecks) && (!isMinor || allChecked(guardianChecks)) && (!needsLegacyType || Boolean(legacyType))
  const toggle = (set: React.Dispatch<React.SetStateAction<Checks>>) => (key: keyof Checks) =>
    set((current) => ({ ...current, [key]: !current[key] }))

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <Card className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">Approve waiver: ID check</h2>
          <p className="mt-1 text-sm text-muted">
            {isMinor
              ? `${participant} is under 18. Check both the player's and the guardian's ID.`
              : `Check ${participant}'s ID against the waiver.`}
          </p>
        </div>

        <IdCheckSection
          heading={`${participant}'s ID`}
          claimedType={waiver.idType}
          image={waiver.idImage}
          matchLabel="The name and birthday match the waiver"
          checks={playerChecks}
          onToggle={toggle(setPlayerChecks)}
          legacyType={legacyType}
          onLegacyType={setLegacyType}
        />

        {isMinor ? (
          <IdCheckSection
            heading={`Guardian's ID${waiver.guardianName ? ` (${waiver.guardianName})` : ''}`}
            claimedType={waiver.guardianIdType}
            image={waiver.guardianIdImage}
            matchLabel="The guardian's name matches the waiver"
            checks={guardianChecks}
            onToggle={toggle(setGuardianChecks)}
          />
        ) : null}

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1"
            disabled={busy || !ready}
            onClick={() => onConfirm({
              ...(needsLegacyType ? { idType: legacyType } : {}),
              idChecked: true,
              ...(isMinor ? { guardianIdChecked: true as const } : {}),
            })}
          >
            {busy ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </Card>
    </div>,
    document.body,
  )
}
