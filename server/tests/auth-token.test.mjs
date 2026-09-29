import assert from 'node:assert/strict'
import { createAuthToken, verifyAuthToken } from '../middleware/auth.js'

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

console.log('auth token regression check passed')
