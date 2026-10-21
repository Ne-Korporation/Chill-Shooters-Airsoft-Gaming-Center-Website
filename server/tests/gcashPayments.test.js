import test from 'node:test'
import assert from 'node:assert/strict'
import { submitGcashPayment } from '../utils/gcashPayments.js'

function createFakeDatabase({ reservation, payments = [] }) {
  const state = { reservation, payments, lockUpdates: [], sessionEnded: false }
  const db = {
    collection(name) {
      if (name.endsWith('_locks')) {
        return {
          updateOne: async (filter, _update, options) => {
            state.lockUpdates.push({ name, id: filter._id, session: options.session })
          },
        }
      }
      if (name === 'reservations') {
        return {
          findOne: async (filter, options) => {
            assert.ok(options.session)
            const ownerId = filter.$and[0].userId
            const requestedId = filter.$and[1].$or[0].id
            return state.reservation?.id === requestedId && state.reservation.userId === ownerId
              ? state.reservation
              : null
          },
        }
      }
      if (name === 'payments') {
        return {
          findOne: async (filter, options) => {
            assert.ok(options.session)
            const reference = filter.$expr.$eq[1]
            return state.payments.find((payment) => payment.transactionReference?.toLowerCase() === reference) || null
          },
          find: (filter, options) => {
            assert.ok(options.session)
            return {
              toArray: async () => state.payments.filter((payment) =>
                payment.reservationId === filter.reservationId &&
                !filter.paymentStatus.$nin.includes(payment.paymentStatus),
              ),
            }
          },
          insertOne: async (payment, options) => {
            assert.ok(options.session)
            state.payments.push(payment)
            return { insertedId: 'new-payment-id' }
          },
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  }
  const startSession = () => ({
    withTransaction: (callback) => callback(),
    endSession: async () => { state.sessionEnded = true },
  })
  return { db, startSession, state }
}

test('GCash submission uses the owned, server-priced reservation and persists only trusted payment fields', async () => {
  const fake = createFakeDatabase({
    reservation: {
      id: 'R-1',
      userId: 'player-1',
      pricingVerified: true,
      depositAmount: 375,
    },
  })
  const { payment, insertedId } = await submitGcashPayment({
    db: fake.db,
    startSession: fake.startSession,
    reservationId: 'R-1',
    userId: 'player-1',
    amount: 375,
    transactionReference: ' TxN-1234 ',
    gcashImageUrl: 'https://example.test/proof.png',
  })

  assert.equal(insertedId, 'new-payment-id')
  assert.equal(payment.amount, 375)
  assert.equal(payment.transactionReference, 'txn-1234')
  assert.equal(payment.paymentStatus, 'pending')
  assert.equal(payment.userId, 'player-1')
  assert.equal(Object.hasOwn(payment, 'role'), false)
  assert.equal(fake.state.lockUpdates.length, 2)
  assert.ok(fake.state.lockUpdates.every((entry) => entry.session === fake.state.lockUpdates[0].session))
  assert.equal(fake.state.sessionEnded, true)
})

test('GCash submission rejects incorrect amounts, unowned reservations, and reused references', async () => {
  const reservation = {
    id: 'R-1',
    userId: 'player-1',
    pricingVerified: true,
    depositAmount: 375,
  }
  const wrongAmount = createFakeDatabase({ reservation })
  await assert.rejects(
    submitGcashPayment({
      db: wrongAmount.db,
      startSession: wrongAmount.startSession,
      reservationId: 'R-1',
      userId: 'player-1',
      amount: 350,
      transactionReference: 'txn-1234',
    }),
    { statusCode: 400 },
  )

  const unowned = createFakeDatabase({ reservation })
  await assert.rejects(
    submitGcashPayment({
      db: unowned.db,
      startSession: unowned.startSession,
      reservationId: 'R-1',
      userId: 'someone-else',
      amount: 375,
      transactionReference: 'txn-2345',
    }),
    { statusCode: 409 },
  )

  const reused = createFakeDatabase({
    reservation,
    payments: [{ transactionReference: 'TXN-3456', reservationId: 'R-other' }],
  })
  await assert.rejects(
    submitGcashPayment({
      db: reused.db,
      startSession: reused.startSession,
      reservationId: 'R-1',
      userId: 'player-1',
      amount: 375,
      transactionReference: 'txn-3456',
    }),
    { statusCode: 409 },
  )
})

test('split payment submission charges one remaining server-calculated share', async () => {
  const fake = createFakeDatabase({
    reservation: {
      id: 'R-2',
      userId: 'player-1',
      pricingVerified: true,
      depositAmount: 375,
      paymentMode: 'split',
      teamSize: 4,
      numberOfPlayers: 8,
    },
    payments: [{ reservationId: 'R-2', amount: 93.75, paymentStatus: 'pending' }],
  })

  const result = await submitGcashPayment({
    db: fake.db,
    startSession: fake.startSession,
    reservationId: 'R-2',
    userId: 'player-1',
    amount: 93.75,
    transactionReference: 'split-1234',
  })
  assert.equal(result.payment.amount, 93.75)
})
