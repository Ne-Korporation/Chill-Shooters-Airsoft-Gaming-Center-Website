import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { selectClass } from '../../pages/operations/shared'

// Must match ACCEPTED_ID_TYPES in server/routes/crud.js.
export const ACCEPTED_ID_TYPES = [
  'PhilSys National ID',
  "Driver's License",
  'Passport',
  'UMID',
  'SSS ID',
  'PRC ID',
  "Voter's ID",
  'Postal ID',
  'PhilHealth ID',
  'Senior Citizen ID',
  'School ID',
] as const

// Approval criteria: the reviewer names the ID they checked and confirms it is valid
// before a waiver can be approved. The server enforces the same rule.
export function WaiverApprovalDialog({
  open,
  participant,
  isMinor,
  guardianIdImage,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  participant: string
  isMinor: boolean
  guardianIdImage?: string
  busy?: boolean
  onConfirm: (check: { idType: string; idChecked: true }) => void
  onCancel: () => void
}) {
  const [idType, setIdType] = useState('')
  const [checks, setChecks] = useState({ readable: false, notExpired: false, matches: false })
  if (!open || typeof document === 'undefined') return null

  const allChecked = checks.readable && checks.notExpired && checks.matches
  const toggle = (key: keyof typeof checks) => setChecks((current) => ({ ...current, [key]: !current[key] }))
  const whose = isMinor ? "guardian's" : "player's"

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-bold">Approve waiver: ID check</h2>
          <p className="mt-1 text-sm text-muted">
            {isMinor
              ? `${participant} is under 18. Check the guardian's ID photo on this waiver.`
              : `Check ${participant}'s government ID (uploaded on their profile or shown at the counter).`}
          </p>
        </div>

        {isMinor && guardianIdImage ? (
          <img src={guardianIdImage} alt="Guardian ID" className="max-h-48 w-full rounded-xl border border-white/10 bg-white object-contain" />
        ) : null}

        <label className="block">
          <div className="mb-2 text-sm font-semibold">ID type</div>
          <select value={idType} onChange={(e) => setIdType(e.target.value)} className={selectClass}>
            <option value="">Select the {whose} ID…</option>
            {ACCEPTED_ID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>

        <div className="space-y-2 text-sm">
          {([
            ['readable', 'The ID photo is clear and readable'],
            ['notExpired', 'The ID is not expired'],
            ['matches', isMinor ? "The guardian's name matches the waiver" : 'The name and birthday match the waiver'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={checks[key]} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1"
            disabled={busy || !idType || !allChecked}
            onClick={() => onConfirm({ idType, idChecked: true })}
          >
            {busy ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </Card>
    </div>,
    document.body,
  )
}
