import assert from 'node:assert/strict'
import { createAuthToken, verifyAuthToken } from '../middleware/auth.js'
import { validateGoogleLoginEligibility, validatePasswordRequirements } from '../routes/auth.js'

const user = { id: 'P-000001', email: 'admin@chillshooters.test', role: 'admin' }
const token = createAuthToken(user)

assert.equal(typeof token, 'string')
assert.ok(token.includes('.'))

const payload = verifyAuthToken(token)
assert.ok(payload)
assert.equal(payload.email, user.email)
assert.equal(payload.role, user.role)
assert.equal(payload.sub, user.id)

const invalid = verifyAuthToken('not-a-valid-token')
assert.equal(invalid, null)

assert.equal(validateGoogleLoginEligibility(null).allowed, false)
// A password account with the same verified email may sign in with Google after confirming.
assert.equal(validateGoogleLoginEligibility({ email: 'employee@chillshooters.test', password: 'hashedpw' }).allowed, true)
assert.equal(validateGoogleLoginEligibility({ email: 'employee@chillshooters.test', password: 'hashedpw' }).linksPasswordAccount, true)
assert.equal(validateGoogleLoginEligibility({ email: 'player@chillshooters.test', password: null, authProvider: 'google' }).allowed, true)

assert.equal(validatePasswordRequirements('weak').valid, false)
assert.equal(validatePasswordRequirements('StrongPass!').valid, true)
assert.equal(validatePasswordRequirements('StrongPass!').errors.length, 0)

console.log('auth token regression check passed')
