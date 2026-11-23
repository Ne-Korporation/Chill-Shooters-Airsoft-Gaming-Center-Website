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

test('registrars only get payment, waiver and ID notifications (and admin announcements)', () => {
  assert.equal(roleReceivesNotification('registrar', { type: 'reservation_payment_finalized' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'waiver_submitted' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'player_id_submitted' }), true)
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

// In-memory notifications and short-id counters, for what notifyRole stores.
function fakeNotifyDb() {
  const stored = []
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => [] }
  return {
    stored,
    collection: () => ({
      insertOne: async (doc) => { stored.push(doc) },
      find: () => cursor,
      countDocuments: async () => stored.length,
    }),
  }
}

test('every ID submitted goes to registrars, and admins get a copy', async () => {
  const { notifyRole } = await import('../utils/paymentProgress.js')
  const db = fakeNotifyDb()
  await notifyRole(db, { role: 'registrar', topic: 'identity', type: 'player_id_submitted', title: 'ID to Verify', message: 'x' })
  assert.deepEqual(db.stored.map((n) => n.targetRole).sort(), ['admin', 'registrar'])
})

test('every game booked goes to marshals, and admins get a copy', async () => {
  const { notifyGameBooked } = await import('../utils/reservationGameplay.js')
  const db = fakeNotifyDb()
  await notifyGameBooked(db, { id: 'R-1', reservationDate: '2026-12-01', reservationTime: 'morning', bookerName: 'Chloe', numberOfPlayers: 4 })
  assert.deepEqual(db.stored.map((n) => [n.targetRole, n.type]).sort(), [['admin', 'game_booked'], ['marshal', 'game_booked']])
  assert.equal(roleReceivesNotification('marshal', { type: 'game_booked' }), true)
})

test('admins also get what registrars are filtered out of, and admin-only notices stay with admins', async () => {
  const { notifyRole } = await import('../utils/paymentProgress.js')
  const db = fakeNotifyDb()
  await notifyRole(db, { role: 'registrar', type: 'reservation_status_update', title: 't', message: 'm' })
  assert.deepEqual(db.stored.map((n) => n.targetRole), ['admin'])
  await notifyRole(db, { role: 'admin', type: 'inventory_low_stock', title: 't', message: 'm' })
  assert.deepEqual(db.stored.map((n) => n.targetRole), ['admin', 'admin'])
})
