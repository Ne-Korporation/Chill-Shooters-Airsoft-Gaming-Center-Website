import test from 'node:test'
import assert from 'node:assert/strict'
import { recordVerifiedStripePayment } from '../utils/stripePayments.js'

function createFakeDatabase(payments = []) {
  const state = { payments, lockSessions: [], sessionEnded: 0 }
  const db = {
    collection(name) {
      if (name === 'payment_deposit_locks') {
        return {
          updateOne: async (_filter, _update, options) => state.lockSessions.push(options.session),
        }
      }
      if (name === 'payments') {
        return {
          findOne: async (filter, options) => {
            assert.ok(options.session)
            return state.payments.find((payment) => {
              if (filter.stripePaymentIntentId) return payment.stripePaymentIntentId === filter.stripePaymentIntentId
              return payment.reservationId === filter.reservationId &&
                !filter.paymentStatus.$nin.includes(payment.paymentStatus)
            }) || null
          },
          insertOne: async (payment, options) => {
            assert.ok(options.session)
            state.payments.push(payment)
          },
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  }
  const startSession = () => ({
    withTransaction: (callback) => callback(),
    endSession: async () => { state.sessionEnded += 1 },
  })
  return { db, startSession, state }
}

test('verified Stripe payment is recorded once and serialized with the reservation payment lock', async () => {
  const fake = createFakeDatabase()
  const args = {
    db: fake.db,
    startSession: fake.startSession,
    reservationId: 'R-1',
    userId: 'player-1',
    paymentIntentId: 'pi_verified',
    amount: 375,
  }

  const first = await recordVerifiedStripePayment(args)
  const retry = await recordVerifiedStripePayment(args)

  assert.equal(first.paymentStatus, 'paid')
  assert.equal(retry.id, first.id)
  assert.equal(fake.state.payments.length, 1)
  assert.equal(fake.state.lockSessions.length, 2)
  assert.notEqual(fake.state.lockSessions[0], fake.state.lockSessions[1])
  assert.equal(fake.state.sessionEnded, 2)
})

test('Stripe confirmation rejects a different active payment but allows retry after failure', async () => {
  const active = createFakeDatabase([{
    reservationId: 'R-2',
    paymentStatus: 'pending',
    paymentMethod: 'GCash',
  }])
  await assert.rejects(
    recordVerifiedStripePayment({
      db: active.db,
      startSession: active.startSession,
      reservationId: 'R-2',
      userId: 'player-1',
      paymentIntentId: 'pi_other',
      amount: 375,
    }),
    { statusCode: 409 },
  )

  const failed = createFakeDatabase([{
    reservationId: 'R-3',
    paymentStatus: 'failed',
    paymentMethod: 'GCash',
  }])
  const payment = await recordVerifiedStripePayment({
    db: failed.db,
    startSession: failed.startSession,
    reservationId: 'R-3',
    userId: 'player-1',
    paymentIntentId: 'pi_retry',
    amount: 375,
  })
  assert.equal(payment.paymentStatus, 'paid')
  assert.equal(failed.state.payments.length, 2)
})
