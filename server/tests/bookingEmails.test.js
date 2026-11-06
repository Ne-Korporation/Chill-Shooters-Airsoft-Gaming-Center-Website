import test from 'node:test'
import assert from 'node:assert/strict'
import transporter from '../services/mailService.js'
import {
  UNPAID_EMAIL_AFTER_MS,
  emailPaymentReceipt,
  emailReservationEvent,
  sendUnpaidReservationEmails,
} from '../services/notificationEmails.js'

// Never send real mail from a test: record what would have been sent instead.
const sent = []
transporter.sendMail = async (mail) => {
  sent.push(mail)
  return { messageId: `test-${sent.length}` }
}

// A tiny in-memory stand-in for the MongoDB calls these emails make.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key]
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$exists' in cond) return cond.$exists ? value !== undefined : value === undefined
      if ('$in' in cond) return cond.$in.includes(value)
      if ('$nin' in cond) return !cond.$nin.includes(value)
      if ('$lte' in cond) return value <= cond.$lte
      if ('$gt' in cond) return value > cond.$gt
    }
    return value === cond
  })
}
function fakeDb(data) {
  const collections = { email_log: [], ...data }
  const collection = (name) => {
    collections[name] ??= []
    const docs = collections[name]
    return {
      createIndex: async () => null,
      find: (filter = {}) => ({ limit: () => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }), toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
      findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
      countDocuments: async (filter) => docs.filter((doc) => matches(doc, filter)).length,
      insertOne: async (doc) => {
        if (name === 'email_log' && docs.some((item) => item.key === doc.key)) throw Object.assign(new Error('dup'), { code: 11000 })
        docs.push(doc)
      },
      updateOne: async (filter, update) => { const doc = docs.find((item) => matches(item, filter)); if (doc) Object.assign(doc, update.$set) },
      updateMany: async (filter, update) => { docs.filter((item) => matches(item, filter)).forEach((doc) => Object.assign(doc, update.$set)) },
    }
  }
  return { collection, collections }
}

const NOW = Date.parse('2026-11-06T02:00:00Z')
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString()
const inMinutes = (minutes) => new Date(NOW + minutes * 60_000).toISOString()
const account = { id: 'P1', email: 'player@example.com', name: 'Player One' }
const booking = (overrides) => ({
  _id: overrides.id, userId: 'P1', reservationStatus: 'pending', reservationDate: '2026-11-07', reservationTime: 'morning',
  locationName: 'Salawag', numberOfPlayers: 2, totalAmount: 1500, depositAmount: 750, ...overrides,
})

test('a booking left unpaid gets one "waiting for payment" email, after a few minutes', async () => {
  sent.length = 0
  const db = fakeDb({
    user_accounts: [account],
    reservations: [
      booking({ id: 'R-new', createdAtISO: minutesAgo(1), paymentDueAtISO: inMinutes(29) }),
      booking({ id: 'R-old', createdAtISO: minutesAgo(UNPAID_EMAIL_AFTER_MS / 60_000 + 1), paymentDueAtISO: inMinutes(20) }),
    ],
    payments: [],
  })
  assert.equal(await sendUnpaidReservationEmails(db, NOW), 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /waiting for payment/)
  assert.match(sent[0].html, /Pay now/)
  // The sweep runs every minute; it never sends the same email twice.
  assert.equal(await sendUnpaidReservationEmails(db, NOW), 0)
  assert.equal(sent.length, 1)
})

test('a booking that was paid gets no "waiting for payment" email', async () => {
  sent.length = 0
  const db = fakeDb({
    user_accounts: [account],
    reservations: [booking({ id: 'R-paid', createdAtISO: minutesAgo(10), paymentDueAtISO: inMinutes(20) })],
    payments: [{ id: 'PMT-1', reservationId: 'R-paid', paymentStatus: 'paid' }],
  })
  assert.equal(await sendUnpaidReservationEmails(db, NOW), 0)
  assert.equal(sent.length, 0)
})

test("the captain's payment receipt is left out when the confirmation email covers it", async () => {
  sent.length = 0
  const db = fakeDb({
    user_accounts: [account, { id: 'P2', email: 'mate@example.com', name: 'Mate' }],
    reservations: [booking({ id: 'R-done', reservationStatus: 'confirmed' })],
  })
  const captainPayment = { id: 'PMT-c', reservationId: 'R-done', userId: 'P1', amount: 750, paymentStatus: 'paid' }
  assert.deepEqual(await emailPaymentReceipt(db, captainPayment, 'paid'), { skipped: 'covered by the confirmation email' })
  // A teammate paying a split share still gets a receipt (they don't get the confirmation).
  const teammatePayment = { id: 'PMT-t', reservationId: 'R-done', userId: 'P2', amount: 375, paymentStatus: 'paid' }
  assert.equal((await emailPaymentReceipt(db, teammatePayment, 'paid')).sent, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'mate@example.com')
})

test('a full day sends one confirmation, once all three bookings are confirmed', async () => {
  sent.length = 0
  const group = ['morning', 'afternoon', 'evening'].map((slot, index) => booking({
    id: `R-${slot}`, reservationTime: slot, bookingGroupId: 'FD-test-group-1', reservationStatus: index === 0 ? 'confirmed' : 'pending',
  }))
  const db = fakeDb({ user_accounts: [account], reservations: group, inventory_holds: [] })
  assert.match((await emailReservationEvent(db, group[0], 'confirmed', 'auto')).skipped, /not fully confirmed/)
  group.forEach((item) => { item.reservationStatus = 'confirmed' })
  for (const item of group) await emailReservationEvent(db, item, 'confirmed', 'auto')
  assert.equal(sent.length, 1)
  assert.match(sent[0].html, /Full day/i)
  assert.match(sent[0].html, /4,500/) // the whole day's total
})
