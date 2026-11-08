import test from 'node:test'
import assert from 'node:assert/strict'
import { slotConflict } from '../utils/bookingSlots.js'
import { bumpTopics, changeSnapshot, topicsForPath } from '../utils/changeFeed.js'

const privateGame = { sessionType: 'private', numberOfPlayers: 12 }
const publicGroup = { sessionType: 'public', numberOfPlayers: 4 }

test('an empty slot takes any booking', () => {
  assert.equal(slotConflict({ reservations: [], holds: [], sessionType: 'public' }), null)
  assert.equal(slotConflict({ reservations: [], holds: [], sessionType: 'private' }), null)
})

test('a booked private game closes the slot to everyone', () => {
  assert.equal(slotConflict({ reservations: [privateGame], sessionType: 'public' }).reason, 'private_booked')
  assert.equal(slotConflict({ reservations: [privateGame], sessionType: 'private' }).reason, 'private_booked')
})

test('a private game someone else is booking right now closes the slot too', () => {
  assert.equal(slotConflict({ holds: [{ sessionType: 'private' }], sessionType: 'public' }).reason, 'being_booked')
  assert.equal(slotConflict({ holds: [{ sessionType: 'private' }], sessionType: 'private' }).reason, 'being_booked')
})

test('public games stay open play, but a private game cannot be booked on top of them', () => {
  assert.equal(slotConflict({ reservations: [publicGroup, publicGroup], sessionType: 'public' }), null)
  assert.equal(slotConflict({ reservations: [publicGroup], sessionType: 'private' }).reason, 'public_booked')
})

test('change requests map to the topics open pages listen for', () => {
  assert.deepEqual(topicsForPath('/api/slot-holds/mine'), ['slots'])
  assert.ok(topicsForPath('/api/reservations/R1/cancel').includes('slots'))
  assert.ok(topicsForPath('/api/demo-pay/abc/pay').includes('payments'))
  assert.ok(topicsForPath('/api/waivers/W1').includes('waivers'))
  assert.deepEqual(topicsForPath('/api/contact'), [])
})

test('bumping a topic moves only that version', () => {
  const before = changeSnapshot()
  bumpTopics('slots')
  const after = changeSnapshot()
  assert.equal(after.versions.slots, before.versions.slots + 1)
  assert.equal(after.versions.payments, before.versions.payments)
  assert.equal(after.bootId, before.bootId)
})
