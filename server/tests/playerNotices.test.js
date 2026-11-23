import test from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyBookingCancelled, notifyBookingConfirmed, notifyGameStatus, notifyPaymentDecision, notifyWaiverDecision, playersOnBooking,
} from '../utils/playerNotices.js'

function fakeDb() {
  const stored = []
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => [] }
  return { stored, collection: () => ({ insertOne: async (doc) => { stored.push(doc) }, find: () => cursor, countDocuments: async () => stored.length }) }
}

const booking = {
  id: 'R-1', userId: 'P1', bookerName: 'Chloe', reservationDate: '2026-12-01', reservationTime: 'evening', locationName: 'Salawag',
  teamMembers: [
    { id: 'P2', name: 'Eunice' },
    { id: 'P3', name: 'Juan' },
    { id: 'P4', name: 'Kid', isMinor: true, guardianId: 'P2' },
    { id: 'P5', name: 'Ana' },
  ],
  invites: [{ playerId: 'P3', status: 'declined' }, { playerId: 'P5', status: 'pending' }],
}

test('everyone still on a booking: the captain and teammates, not one who declined, not a minor', () => {
  assert.deepEqual(playersOnBooking(booking), ['P1', 'P2', 'P5'])
  assert.deepEqual(playersOnBooking({ ...booking, walkIn: true }), [])
})

test('a confirmed booking tells the captain and every teammate (not only payers)', async () => {
  const db = fakeDb()
  await notifyBookingConfirmed(db, booking, { balance: 500 })
  assert.deepEqual(db.stored.map((n) => n.userId), ['P1', 'P2', 'P5'])
  assert.match(db.stored[0].message, /remaining ₱500/)
  assert.match(db.stored[1].message, /Chloe's game/)
})

test("the one who cancelled isn't told; everyone else is", async () => {
  const db = fakeDb()
  await notifyBookingCancelled(db, booking, { reason: 'captain', except: 'P1' })
  assert.deepEqual(db.stored.map((n) => n.userId), ['P2', 'P5'])
})

test('players are told when their game starts and ends', async () => {
  const db = fakeDb()
  await notifyGameStatus(db, booking, 'Ongoing')
  await notifyGameStatus(db, booking, 'Completed')
  await notifyGameStatus(db, booking, 'Scheduled')
  assert.deepEqual(db.stored.map((n) => n.type), [
    'reservation_game_started', 'reservation_game_started', 'reservation_game_started',
    'reservation_game_completed', 'reservation_game_completed', 'reservation_game_completed',
  ])
})

test('a payment decision goes to whoever paid', async () => {
  const db = fakeDb()
  await notifyPaymentDecision(db, { userId: 'P2', amount: 750, reservationId: 'R-1' }, 'rejected', 'Blurry receipt')
  assert.equal(db.stored[0].userId, 'P2')
  assert.match(db.stored[0].message, /Blurry receipt/)
})

test("a child's waiver decision goes to the parent", async () => {
  const db = fakeDb()
  await notifyWaiverDecision(db, { id: 'W-1', userId: 'P4', forChild: true, guardianId: 'P2', fullName: 'Kid' }, 'approved')
  assert.equal(db.stored[0].userId, 'P2')
  assert.match(db.stored[0].title, /Kid's waiver/)
})
