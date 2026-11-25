import test from 'node:test'
import assert from 'node:assert/strict'
import { describeRequest, labelOfEntry, moduleOfEntry, sanitizeForAudit } from '../utils/audit.js'

test('known actions get a readable label, module and the record they touch', () => {
  const removed = describeRequest('POST', '/reservations/R-ABC/charges/CHG-1/remove', {})
  assert.equal(removed.module, 'payment')
  assert.equal(removed.label, 'Charge removed from a bill')
  assert.equal(removed.severity, 'critical')
  assert.equal(removed.resourceId, 'R-ABC')

  assert.equal(describeRequest('PUT', '/payments/PMT-1/verify', { paymentStatus: 'failed' }).label, 'Payment rejected')
  assert.equal(describeRequest('PUT', '/payments/PMT-1/verify', { paymentStatus: 'paid' }).label, 'Payment verified')
  assert.equal(describeRequest('PUT', '/damage-reports/DMG-1/review', { decision: 'waive' }).label, 'Damage fee waived')
  assert.equal(describeRequest('PUT', '/payments/bank-details', {}).resourceId, '')
})

test('generic record writes are named after their collection', () => {
  const game = describeRequest('PUT', '/gameplay/GP-1', { $set: { Status: 'Ongoing' } })
  assert.equal(game.module, 'operations')
  assert.equal(game.label, 'Game status set to Ongoing')
  assert.equal(game.resourceId, 'GP-1')

  const deleted = describeRequest('DELETE', '/weapons/W-9', undefined)
  assert.equal(deleted.module, 'weapon')
  assert.equal(deleted.label, 'Weapon deleted')
  assert.equal(deleted.severity, 'warning')
})

test('anything without a rule is still recorded under its path', () => {
  const other = describeRequest('POST', '/something/new', {})
  assert.equal(other.module, 'other')
  assert.equal(other.label, 'POST /something/new')
})

test('secrets and files never reach the audit log', () => {
  const clean = sanitizeForAudit({
    password: 'hunter2',
    signatureImage: 'data:image/png;base64,AAAA',
    note: 'x'.repeat(500),
    nested: { resetCode: '123456', ok: 1 },
  })
  assert.equal(clean.password, '[hidden]')
  assert.equal(clean.signatureImage, '[hidden]')
  assert.equal(clean.nested.resetCode, '[hidden]')
  assert.equal(clean.nested.ok, 1)
  assert.ok(clean.note.length <= 201)
})

test('older entries get a module and label from their action', () => {
  assert.equal(moduleOfEntry({ action: 'player_suspended' }), 'player')
  assert.equal(moduleOfEntry({ action: 'closed_day_set' }), 'calendar')
  assert.equal(moduleOfEntry({ action: 'staff_account_closed' }), 'staff')
  assert.equal(labelOfEntry({ action: 'reservation_rescheduled' }), 'Reservation rescheduled')
})
