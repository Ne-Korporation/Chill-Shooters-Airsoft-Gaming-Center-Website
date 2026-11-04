import assert from 'node:assert/strict'
import { hasValidIdentity, identityVerifiedFields } from '../utils/identityValidity.js'

const now = Date.parse('2026-11-04T00:00:00Z')
const future = '2027-01-01T00:00:00Z'
const past = '2026-01-01T00:00:00Z'

assert.equal(hasValidIdentity({ identityVerificationStatus: 'verified', identityValidUntilISO: future }, now), true)
assert.equal(hasValidIdentity({ identityVerificationStatus: 'verified', identityValidUntilISO: past }, now), false)
// Verified before validity dates existed: counts until the sweep gives it one.
assert.equal(hasValidIdentity({ identityVerificationStatus: 'verified' }, now), true)
assert.equal(hasValidIdentity({ identityVerificationStatus: 'expired' }, now), false)
assert.equal(hasValidIdentity({ identityVerificationStatus: 'not_submitted' }, now), false)
// A newer ID in review: the previous verification still counts until it would have run out.
assert.equal(hasValidIdentity({ identityVerificationStatus: 'pending_review', identityPreviousValidUntilISO: future }, now), true)
assert.equal(hasValidIdentity({ identityVerificationStatus: 'pending_review', identityPreviousValidUntilISO: past }, now), false)
assert.equal(hasValidIdentity({ identityVerificationStatus: 'rejected', identityPreviousValidUntilISO: future }, now), true)

const fields = identityVerifiedFields('2026-11-04T00:00:00.000Z')
assert.equal(fields.identityValidUntilISO.slice(0, 10), '2027-11-04')

console.log('identity validity checks passed')
