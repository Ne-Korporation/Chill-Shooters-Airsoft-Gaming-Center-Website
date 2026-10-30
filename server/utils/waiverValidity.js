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
  await waivers.updateMany(
    { ...approved, validUntilISO: { $lt: nowISO } },
    { $set: { status: 'expired', expiredAtISO: nowISO } },
  )
}
