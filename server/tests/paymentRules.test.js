import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPaymentStatusUpdate,
  getGcashAmountDue,
  hasActivePayment,
  normalizeGcashReference,
  paymentAmountMatchesDue,
  stripeIntentMatchesReservation,
} from '../utils/paymentRules.js'

test('GCash due ignores failed payments and caps split shares at the remaining deposit', () => {
  const reservation = {
    depositAmount: 375,
    paymentMode: 'split',
    teamSize: 4,
    numberOfPlayers: 8,
  }

  assert.equal(getGcashAmountDue(reservation, [
    { amount: 90, paymentStatus: 'pending' },
    { amount: 10, paymentStatus: 'failed' },
  ]), 93.75)
  assert.equal(getGcashAmountDue(reservation, [
    { amount: 300, paymentStatus: 'pending' },
  ]), 75)
  assert.throws(
    () => getGcashAmountDue({ ...reservation, teamSize: 1 }, []),
    { statusCode: 400 },
  )
})

test('GCash references are normalized and amounts must match the due amount', () => {
  assert.equal(normalizeGcashReference('  AbC123  '), 'abc123')
  assert.throws(() => normalizeGcashReference('no'), { statusCode: 400 })
  assert.equal(paymentAmountMatchesDue('375.00', 375), true)
  assert.equal(paymentAmountMatchesDue(374, 375), false)
  assert.equal(paymentAmountMatchesDue(1, 0), false)
})

test('Stripe verification matches succeeded PHP payments to the reservation and owner', () => {
  const reservation = { depositAmount: 375, userId: 'player-1' }
  const intent = {
    status: 'succeeded',
    currency: 'php',
    amount: 37500,
    metadata: { reservationId: 'R-1', userId: 'player-1' },
  }

  assert.equal(stripeIntentMatchesReservation(intent, reservation, 'R-1'), true)
  assert.equal(stripeIntentMatchesReservation({ ...intent, status: 'processing' }, reservation, 'R-1'), false)
  assert.equal(stripeIntentMatchesReservation({
    ...intent,
    metadata: { ...intent.metadata, userId: 'other-player' },
  }, reservation, 'R-1'), false)
})

test('manual payment verification produces actor-attributed audit data and blocks paid reversals', () => {
  const update = buildPaymentStatusUpdate({
    payment: { paymentStatus: 'pending' },
    nextStatus: 'paid',
    actorId: 'registrar-1',
    actorRole: 'registrar',
    reason: 'Reference checked',
    changedAtISO: '2026-10-20T00:00:00.000Z',
  })

  assert.deepEqual(update.$push.auditTrail, {
    previousStatus: 'pending',
    status: 'paid',
    changedBy: 'registrar-1',
    changedByRole: 'registrar',
    reason: 'Reference checked',
    changedAtISO: '2026-10-20T00:00:00.000Z',
  })
  assert.equal(update.$set.verifiedBy, 'registrar-1')
  assert.throws(
    () => buildPaymentStatusUpdate({
      payment: { paymentStatus: 'paid' },
      nextStatus: 'failed',
      actorId: 'registrar-1',
      actorRole: 'registrar',
      changedAtISO: 'now',
    }),
    { statusCode: 409 },
  )
  assert.throws(
    () => buildPaymentStatusUpdate({
      payment: { paymentStatus: 'paid', stripePaymentIntentId: 'pi_123' },
      nextStatus: 'pending',
      actorId: 'registrar-1',
      actorRole: 'registrar',
      changedAtISO: 'now',
    }),
    { statusCode: 409 },
  )
})

test('active-payment detection ignores failed and rejected records', () => {
  assert.equal(hasActivePayment([{ paymentStatus: 'failed' }, { status: 'rejected' }]), false)
  assert.equal(hasActivePayment([{ paymentStatus: 'pending' }]), true)
})
