import { validUntilFrom } from './waiverValidity.js'
import { notifyUser } from './paymentProgress.js'

// A verified ID counts for 12 months, like the waiver it fills in. After that the player submits
// their ID again from their profile.

// While a player's newer ID waits for review, the previous verification keeps counting until
// it would have expired.
export function hasValidIdentity(account, now = Date.now()) {
  if (!account) return false
  const until = (iso) => Date.parse(iso || '')
  if (account.identityVerificationStatus === 'verified') {
    const validUntil = until(account.identityValidUntilISO)
    return !Number.isFinite(validUntil) || validUntil > now
  }
  const previous = until(account.identityPreviousValidUntilISO)
  return Number.isFinite(previous) && previous > now
}

// MongoDB filter for accounts with a valid identity (same rule as hasValidIdentity).
export function validIdentityFilter(now = new Date()) {
  const nowISO = now.toISOString()
  return {
    $or: [
      { identityVerificationStatus: 'verified', identityValidUntilISO: { $exists: false } },
      { identityVerificationStatus: 'verified', identityValidUntilISO: { $gt: nowISO } },
      { identityPreviousValidUntilISO: { $gt: nowISO } },
    ],
  }
}

// Fields set when staff verify an ID.
export function identityVerifiedFields(nowISO = new Date().toISOString()) {
  return { identityVerifiedAtISO: nowISO, identityValidUntilISO: validUntilFrom(nowISO) }
}

let lastSweep = 0

// Gives verifications from before this rule a validity date, then expires the ones past it and
// tells each player to submit their ID again.
export async function expireOldIdentities(db, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastSweep < 5 * 60_000) return 0
  lastSweep = now
  const accounts = db.collection('user_accounts')

  const legacy = await accounts.find(
    { identityVerificationStatus: 'verified', identityValidUntilISO: { $exists: false } },
    { projection: { identityVerificationUpdatedAt: 1, updatedAtISO: 1, createdAtISO: 1 } },
  ).limit(1000).toArray()
  for (const account of legacy) {
    const start = account.identityVerificationUpdatedAt || account.updatedAtISO || account.createdAtISO
    await accounts.updateOne({ _id: account._id }, { $set: { identityValidUntilISO: validUntilFrom(start) } })
  }

  const nowISO = new Date(now).toISOString()
  const due = await accounts.find(
    { identityVerificationStatus: 'verified', identityValidUntilISO: { $lte: nowISO } },
    { projection: { id: 1 } },
  ).limit(500).toArray()
  for (const account of due) {
    const updated = await accounts.updateOne(
      { _id: account._id, identityVerificationStatus: 'verified' },
      { $set: { identityVerificationStatus: 'expired', identityExpiredAtISO: nowISO } },
    )
    if (updated.modifiedCount === 1) {
      await notifyUser(db, {
        userId: account.id,
        type: 'identity_expired',
        title: 'Update your ID',
        message: 'Your ID verification is a year old and has expired. Submit your ID again on your profile so you can keep signing waivers and joining teams.',
      })
    }
  }
  // A newer ID still waiting for review once the previous one has run out: nothing left to count.
  await accounts.updateMany(
    { identityPreviousValidUntilISO: { $lte: nowISO } },
    { $unset: { identityPreviousValidUntilISO: '' } },
  )
  return due.length
}
