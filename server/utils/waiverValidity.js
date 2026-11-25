import { logAudit } from './audit.js'

// Approved waivers are valid for 12 months. After that the player answers the waiver again;
// the old record is kept as "expired" so its history isn't lost.
export const WAIVER_VALID_DAYS = 365
const DAY_MS = 86_400_000

// Statuses that still count as the player's current waiver; anything else (denied, expired)
// lets them submit a new one.
export const ACTIVE_WAIVER_STATUSES = ['approved', 'pending', 'review', 'submitted']

export function validUntilFrom(approvedAtISO) {
  const start = Date.parse(approvedAtISO || '')
  return new Date((Number.isFinite(start) ? start : Date.now()) + WAIVER_VALID_DAYS * DAY_MS).toISOString()
}

let lastSweep = 0

// Backfills validUntilISO on approved waivers that predate it, then expires the ones past it.
export async function expireOldWaivers(db, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastSweep < 5 * 60_000) return
  lastSweep = now
  const waivers = db.collection('waivers')
  const approved = { status: { $regex: '^approved$', $options: 'i' } }

  const legacy = await waivers.find(
    { ...approved, validUntilISO: { $exists: false } },
    { projection: { approvedAtISO: 1, reviewedAtISO: 1, updatedAtISO: 1, submittedAtISO: 1, createdAtISO: 1 } },
  ).limit(1000).toArray()
  for (const waiver of legacy) {
    const start = waiver.approvedAtISO || waiver.reviewedAtISO || waiver.updatedAtISO || waiver.submittedAtISO || waiver.createdAtISO
    await waivers.updateOne({ _id: waiver._id }, { $set: { validUntilISO: validUntilFrom(start) } })
  }

  const nowISO = new Date(now).toISOString()
  const due = await waivers.find({ ...approved, validUntilISO: { $lt: nowISO } }, { projection: { id: 1, fullName: 1 } }).toArray()
  if (!due.length) return
  await waivers.updateMany(
    { _id: { $in: due.map((waiver) => waiver._id) } },
    { $set: { status: 'expired', expiredAtISO: nowISO } },
  )
  await logAudit(db, null, {
    module: 'waiver',
    action: 'waivers_expired_yearly',
    label: 'Waivers expired (12 months old)',
    resourceType: 'waivers',
    summary: `${due.length} approved waiver${due.length === 1 ? '' : 's'} reached 12 months and expired: ${due.slice(0, 5).map((w) => w.fullName || w.id).join(', ')}${due.length > 5 ? '…' : ''}`,
    details: { waivers: due.map((w) => w.id) },
  })
}

// The admin changed the waiver text: every current waiver (approved or waiting for review) was
// signed under the old text, so it expires now and its player answers the new one. The records
// are kept as "expired" with the reason. Returns the waivers that expired.
export async function expireWaiversForNewText(db, nowISO = new Date().toISOString()) {
  const waivers = db.collection('waivers')
  const current = {
    archived: { $ne: true },
    status: { $regex: `^(${ACTIVE_WAIVER_STATUSES.join('|')})$`, $options: 'i' },
  }
  const affected = await waivers.find(current, { projection: { id: 1, userId: 1, fullName: 1, forChild: 1, guardianId: 1 } }).toArray()
  if (affected.length) {
    await waivers.updateMany(
      { _id: { $in: affected.map((waiver) => waiver._id) } },
      { $set: { status: 'expired', expiredAtISO: nowISO, expiredReason: 'waiver_text_changed' } },
    )
    await logAudit(db, null, {
      module: 'waiver',
      action: 'waivers_expired_new_text',
      label: 'Waivers expired (waiver text changed)',
      severity: 'warning',
      resourceType: 'waivers',
      summary: `${affected.length} current waiver${affected.length === 1 ? '' : 's'} expired because the waiver text changed; the players were notified and emailed`,
      details: { waivers: affected.map((w) => w.id) },
    })
  }
  return affected
}
