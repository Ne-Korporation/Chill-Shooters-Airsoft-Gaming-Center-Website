import test from 'node:test'
import assert from 'node:assert/strict'
import { roleReceivesNotification } from '../utils/roleNotifications.js'

test('marshals only get new-game notifications (and admin announcements)', () => {
  assert.equal(roleReceivesNotification('marshal', { type: 'gameplay_created' }), true)
  assert.equal(roleReceivesNotification('marshal', { type: 'announcement' }), true)
  for (const type of ['game_due_to_start', 'inventory_low_stock', 'reservation_status_update', 'waiver_submitted', 'reservation_payment_finalized']) {
    assert.equal(roleReceivesNotification('marshal', { type }), false, type)
  }
})

test('registrars only get payment and waiver notifications (and admin announcements)', () => {
  assert.equal(roleReceivesNotification('registrar', { type: 'reservation_payment_finalized' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'waiver_submitted' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'reservation_status_update', topic: 'waiver' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'announcement' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'reservation_status_update' }), false)
  assert.equal(roleReceivesNotification('registrar', { type: 'gameplay_created' }), false)
})

test('admins get everything', () => {
  for (const type of ['game_due_to_start', 'inventory_low_stock', 'reservation_status_update', 'contact_message']) {
    assert.equal(roleReceivesNotification('admin', { type }), true, type)
  }
})
