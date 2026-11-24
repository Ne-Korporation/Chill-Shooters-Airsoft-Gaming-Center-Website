import test from 'node:test'
import assert from 'node:assert/strict'
import { getPaymentProgress, openSlotHold } from '../utils/paymentRules.js'

// After a teammate declined: their ₱750 moved to the captain's field balance (deposit 7500 -> 6750).
const booking = {
  userId: 'C', paymentMode: 'split', depositAmount: 6750, totalAmount: 7500, splitPayerIds: ['A', 'B'],
  splitShares: { C: 3750, A: 1500, B: 1500 },
  openSlots: [{ id: 'S1', amount: 750, status: 'open', onsite: true }],
}

test("a spot whose share moved to the field doesn't hold anything back online", () => {
  assert.equal(openSlotHold(booking), 0)
  // An older spot still waiting on the captain online does.
  assert.equal(openSlotHold({ openSlots: [{ amount: 750, status: 'open' }] }), 750)
})

test('the rest of the team paying online finishes the booking, with the share left for the counter', () => {
  const payments = [
    { userId: 'C', amount: 3750, paymentStatus: 'paid' },
    { userId: 'A', amount: 1500, paymentStatus: 'paid' },
    { userId: 'B', amount: 1500, paymentStatus: 'paid' },
  ]
  assert.equal(getPaymentProgress(booking, payments).state, 'finalized')
})
