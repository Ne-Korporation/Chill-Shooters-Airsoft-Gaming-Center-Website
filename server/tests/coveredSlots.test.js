import test from 'node:test'
import assert from 'node:assert/strict'
import { settleCoveredSlots } from '../utils/paymentProgress.js'

// Only the update settleCoveredSlots makes: mark one spot paid.
function fakeDb(reservation) {
  return {
    collection: () => ({
      updateOne: async (filter, update) => {
        const slot = reservation.openSlots.find((s) => s.id === filter.openSlots.$elemMatch.id && s.status === 'covering')
        if (!slot) return { modifiedCount: 0 }
        slot.status = update.$set['openSlots.$.status']
        return { modifiedCount: 1 }
      },
    }),
  }
}

const booking = () => ({
  _id: 'x', userId: 'C', depositAmount: 7500, teamSize: 7,
  splitShares: { C: 1500, A: 750, B: 750 },
  openSlots: [{ id: 'S1', amount: 750, status: 'covering' }],
})

test("a spot the captain paid for is done as soon as the captain's payments cover it, before the team finishes", async () => {
  const reservation = booking()
  const settled = await settleCoveredSlots(fakeDb(reservation), reservation, [
    { userId: 'C', amount: 1500, paymentStatus: 'paid' },
    { userId: 'C', amount: 750, paymentStatus: 'paid' },
    { userId: 'A', amount: 750, paymentStatus: 'paid' },
  ])
  assert.equal(settled, 1)
  assert.equal(reservation.openSlots[0].status, 'paid')
})

test('a spot stays covering until the captain has paid their own share and the spot', async () => {
  const reservation = booking()
  const settled = await settleCoveredSlots(fakeDb(reservation), reservation, [
    { userId: 'C', amount: 1500, paymentStatus: 'paid' },
    { userId: 'C', amount: 750, paymentStatus: 'rejected' },
  ])
  assert.equal(settled, 0)
  assert.equal(reservation.openSlots[0].status, 'covering')
})
